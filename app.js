const STORAGE_KEY = "laboratory-calendar-events-v1";

const calendarGrid = document.querySelector("#calendarGrid");
const monthTitle = document.querySelector("#monthTitle");
const clock = document.querySelector("#clock");
const todayLabel = document.querySelector("#todayLabel");
const analogClock = document.querySelector("#analogClock");
const hourHand = document.querySelector("#hourHand");
const minuteHand = document.querySelector("#minuteHand");
const secondHand = document.querySelector("#secondHand");
const dialog = document.querySelector("#eventDialog");
const eventForm = document.querySelector("#eventForm");
const busDialog = document.querySelector("#busDialog");
const TIMETABLES = window.BUS_TIMETABLES;
const BUS_PERIODS = window.BUS_PERIODS;
let activeTimetable = "yamashina";

const fields = {
  id: document.querySelector("#eventId"),
  date: document.querySelector("#eventDate"),
  time: document.querySelector("#eventTime"),
  title: document.querySelector("#eventTitle"),
  note: document.querySelector("#eventNote"),
};

let displayedMonth = startOfMonth(new Date());
let events = [];
let homeBusDirection = "inbound";
let currentUser = null;

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `通信に失敗しました（${response.status}）`);
  return payload;
}

async function loadEvents() {
  try {
    const sharedEvents = await requestJson("/api/events");
    const localEvents = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (sharedEvents.length === 0 && Array.isArray(localEvents) && localEvents.length > 0) {
      const migrated = await Promise.all(localEvents.map((entry) => saveEvent(entry)));
      localStorage.removeItem(STORAGE_KEY);
      return migrated;
    }
    return sharedEvents;
  } catch (error) {
    console.error(error);
    alert("共有予定を読み込めませんでした。server.pyで起動しているか確認してください。");
    return events;
  }
}

function saveEvent(entry) {
  return requestJson("/api/events", { method: "POST", body: JSON.stringify(entry) });
}

function deleteEvent(id) {
  return requestJson(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function refreshEvents() {
  events = await loadEvents();
  renderCalendar();
}

function updateClock() {
  const now = new Date();
  clock.textContent = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  clock.dateTime = now.toISOString();
  todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  }).format(now);

  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  secondHand.style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
  minuteHand.style.transform = `translateX(-50%) rotate(${minutes * 6}deg)`;
  hourHand.style.transform = `translateX(-50%) rotate(${hours * 30}deg)`;
  analogClock.setAttribute("aria-label", `現在時刻 ${clock.textContent}`);
}

function isUniversityBreak(date) {
  const key = toDateKey(date);
  return key >= BUS_PERIODS.universityBreak.start && key <= BUS_PERIODS.universityBreak.end;
}

function decodeBusTime(encoded, date) {
  if (encoded.includes("D") && isUniversityBreak(date)) return null;
  if (encoded.includes("B") && !isUniversityBreak(date)) return null;
  return encoded.slice(0, 5);
}

function getScheduleGroup(routeKey, date) {
  const day = date.getDay();
  const dateKey = toDateKey(date);
  if (routeKey === "summer") return BUS_PERIODS.specialShuttleDates.has(dateKey) ? "special" : null;
  if (routeKey === "shuttle") return day >= 1 && day <= 5 && !isUniversityBreak(date) ? "weekday" : null;
  if (routeKey === "yamashina") {
    if (day >= 1 && day <= 5 && !BUS_PERIODS.holidays.has(dateKey)) return "weekday";
    if (day === 6) return "saturday";
    return null;
  }
  if (routeKey === "kyoto") {
    return day >= 1 && day <= 5 && !BUS_PERIODS.holidays.has(dateKey) ? "weekday" : "holiday";
  }
  return null;
}

function renderNextBuses() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const routes = [
    { key: "yamashina", short: "デモ路線A", type: "keihan" },
    { key: "kyoto", short: "デモ路線B", type: "keihan" },
    { key: BUS_PERIODS.specialShuttleDates.has(toDateKey(now)) ? "summer" : "shuttle", short: "無料シャトル", type: "shuttle" },
  ];
  const upcoming = [];
  routes.forEach((route) => {
    const groupKey = getScheduleGroup(route.key, now);
    if (!groupKey) return;
    const direction = TIMETABLES[route.key].groups[groupKey][homeBusDirection];
    direction.times.forEach((encoded) => {
      const time = decodeBusTime(encoded, now);
      if (!time) return;
      const [hour, minute] = time.split(":").map(Number);
      const departureMinutes = hour * 60 + minute;
      if (departureMinutes < currentMinutes) return;
      upcoming.push({ ...route, time, wait: departureMinutes - currentMinutes, destination: direction.label });
    });
  });
  upcoming.sort((a, b) => a.wait - b.wait);
  const nextByRoute = upcoming.filter((bus, index, buses) => (
    buses.findIndex((candidate) => candidate.key === bus.key) === index
  ));

  const list = document.querySelector("#nextBusList");
  list.replaceChildren();
  if (nextByRoute.length === 0) {
    const empty = document.createElement("p");
    empty.className = "next-bus-empty";
    empty.textContent = "本日の表示対象便は終了しました";
    list.append(empty);
    return;
  }
  nextByRoute.forEach((bus) => {
    const card = document.createElement("article");
    card.className = `next-bus-card ${bus.type}`;
    const route = document.createElement("span");
    route.className = "next-bus-route";
    route.textContent = bus.short;
    const destination = document.createElement("span");
    destination.className = "next-bus-destination";
    destination.textContent = bus.destination;
    const time = document.createElement("time");
    time.className = "next-bus-time";
    time.dateTime = bus.time;
    time.textContent = bus.time;
    const countdown = document.createElement("span");
    countdown.className = "next-bus-countdown";
    countdown.textContent = bus.wait === 0 ? "まもなく" : `あと${bus.wait}分`;
    card.append(route, destination, time, countdown);
    list.append(card);
  });
}

function renderCalendar() {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  monthTitle.textContent = `${year}年 ${month + 1}月`;

  const firstWeekday = (displayedMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const todayKey = toDateKey(new Date());
  calendarGrid.replaceChildren();

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = toDateKey(date);
    const dayEvents = events
      .filter((event) => event.date === dateKey)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    const cell = document.createElement("article");
    cell.className = "day-cell";
    if (date.getMonth() !== month) cell.classList.add("outside");
    if (dateKey === todayKey) cell.classList.add("today");
    if (index % 7 === 5) cell.classList.add("saturday-cell");
    if (index % 7 === 6) cell.classList.add("sunday-cell");
    cell.dataset.date = dateKey;
    cell.tabIndex = 0;
    cell.setAttribute("aria-label", `${date.getMonth() + 1}月${date.getDate()}日。予定${dayEvents.length}件`);

    const number = document.createElement("div");
    number.className = "day-number";
    number.textContent = date.getDate();
    cell.append(number);

    const list = document.createElement("div");
    list.className = "event-list";
    dayEvents.slice(0, 3).forEach((event) => list.append(createEventChip(event)));
    if (dayEvents.length > 3) {
      const more = document.createElement("span");
      more.className = "more-events";
      more.textContent = `ほか ${dayEvents.length - 3}件`;
      list.append(more);
    }
    cell.append(list);

    cell.addEventListener("click", (event) => {
      if (!event.target.closest(".event-chip")) openNewEvent(dateKey);
    });
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === cell) openNewEvent(dateKey);
    });
    calendarGrid.append(cell);
  }
}

function createEventChip(event) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "event-chip";
  button.title = [event.time, event.title, event.note].filter(Boolean).join(" — ");

  if (event.time) {
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = event.time;
    button.append(time);
  }
  button.append(document.createTextNode(event.title));
  button.addEventListener("click", () => openExistingEvent(event.id));
  return button;
}

function requireEditingPermission() {
  if (currentUser) return true;
  alert("この操作にはログインおよび管理者承認が必要です。");
  openAuthDialog();
  return false;
}

function openNewEvent(dateKey) {
  if (!requireEditingPermission()) return;
  eventForm.reset();
  fields.id.value = "";
  fields.date.value = dateKey;
  document.querySelector("#dialogTitle").textContent = "予定の追加";
  document.querySelector("#deleteEvent").hidden = true;
  dialog.showModal();
  fields.title.focus();
}

function openExistingEvent(id) {
  if (!requireEditingPermission()) return;
  const event = events.find((item) => item.id === id);
  if (!event) return;
  fields.id.value = event.id;
  fields.date.value = event.date;
  fields.time.value = event.time || "";
  fields.title.value = event.title;
  fields.note.value = event.note || "";
  document.querySelector("#dialogTitle").textContent = "予定の編集";
  document.querySelector("#deleteEvent").hidden = false;
  dialog.showModal();
}

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!eventForm.reportValidity()) return;

  const entry = {
    id: fields.id.value || crypto.randomUUID(),
    date: fields.date.value,
    time: fields.time.value,
    title: fields.title.value.trim(),
    note: fields.note.value.trim(),
  };
  try {
    await saveEvent(entry);
    await refreshEvents();
    dialog.close();
  } catch (error) {
    if (/ログイン|認証|401|403/.test(error.message)) currentUser = null, renderAccount();
    alert(error.message);
  }
});

document.querySelector("#deleteEvent").addEventListener("click", async () => {
  if (!fields.id.value || !confirm("この予定を削除しますか？")) return;
  try {
    await deleteEvent(fields.id.value);
    await refreshEvents();
    dialog.close();
  } catch (error) {
    if (/ログイン|認証|401|403/.test(error.message)) currentUser = null, renderAccount();
    alert(error.message);
  }
});

const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
let signupMode = false;

function renderAccount() {
  const loggedIn = Boolean(currentUser);
  document.querySelector("#currentUser").hidden = !loggedIn;
  document.querySelector("#authButton").hidden = loggedIn;
  document.querySelector("#logoutButton").hidden = !loggedIn;
  document.querySelector("#adminButton").hidden = !loggedIn || currentUser.role !== "admin";
  if (loggedIn) document.querySelector("#currentUser").textContent = `${currentUser.username}${currentUser.role === "admin" ? "（管理者）" : ""}`;
}

function openAuthDialog() {
  authForm.reset();
  document.querySelector("#authMessage").textContent = "";
  authDialog.showModal();
}

function setAuthMode(register) {
  signupMode = register;
  document.querySelector("#authDialogTitle").textContent = register ? "アカウント申請" : "ログイン";
  document.querySelector("#authHelp").textContent = register ? "申請後、管理者による承認が必要です。" : "承認済みアカウントでログインしてください。";
  document.querySelector("#submitAuth").textContent = register ? "申請する" : "ログイン";
  document.querySelector("#toggleSignup").textContent = register ? "ログインに戻る" : "アカウントを申請";
}

async function loadCurrentUser() {
  try { currentUser = (await requestJson("/api/me")).user; }
  catch (error) { console.error(error); currentUser = null; }
  renderAccount();
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authForm.reportValidity()) return;
  const message = document.querySelector("#authMessage");
  const payload = { username: document.querySelector("#authUsername").value, password: document.querySelector("#authPassword").value };
  try {
    const result = await requestJson(signupMode ? "/api/signup" : "/api/login", { method: "POST", body: JSON.stringify(payload) });
    if (signupMode) { message.textContent = "申請を受け付けました。管理者の承認後にログインできます。"; return; }
    currentUser = result.user;
    renderAccount(); authDialog.close(); await refreshEvents();
  } catch (error) { message.textContent = error.message; }
});
document.querySelector("#authButton").addEventListener("click", () => { setAuthMode(false); openAuthDialog(); });
document.querySelector("#closeAuthDialog").addEventListener("click", () => authDialog.close());
document.querySelector("#toggleSignup").addEventListener("click", () => setAuthMode(!signupMode));
document.querySelector("#logoutButton").addEventListener("click", async () => {
  try {
    await requestJson("/api/logout", { method: "POST", body: "{}" });
    currentUser = null;
    renderAccount();
  } catch (error) {
    alert(error.message);
  }
});

async function openAdminDialog() {
  document.querySelector("#adminMessage").textContent = "";
  try {
    const users = await requestJson("/api/admin/users");
    const list = document.querySelector("#userList"); list.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td></td><td></td><td></td><td></td>`;
      row.children[0].textContent = user.username; row.children[1].textContent = new Date(user.created_at).toLocaleString("ja-JP"); row.children[2].textContent = user.status;
      if (user.status === "pending") ["approve", "reject"].forEach((action) => {
        const button = document.createElement("button"); button.type = "button"; button.className = action === "approve" ? "primary-button" : "danger-button"; button.textContent = action === "approve" ? "承認" : "拒否";
        button.addEventListener("click", async () => {
          try {
            await requestJson("/api/admin/approve", { method: "POST", body: JSON.stringify({ user_id: user.id, action }) });
            await openAdminDialog();
          } catch (error) {
            document.querySelector("#adminMessage").textContent = error.message;
          }
        }); row.children[3].append(button);
      });
      list.append(row);
    });
    adminDialog.showModal();
  } catch (error) { alert(error.message); }
}
const adminDialog = document.querySelector("#adminDialog");
document.querySelector("#adminButton").addEventListener("click", openAdminDialog);
document.querySelector("#closeAdminDialog").addEventListener("click", () => adminDialog.close());
document.querySelector("#themeButton").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme; localStorage.setItem("laboratory-calendar-theme", theme);
  document.querySelector("#themeButton").textContent = theme === "dark" ? "ライトモード" : "ダークモード";
  document.querySelector("#themeButton").setAttribute("aria-pressed", String(theme === "dark"));
});

document.querySelector("#previousMonth").addEventListener("click", () => {
  displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.querySelector("#nextMonth").addEventListener("click", () => {
  displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
  renderCalendar();
});
document.querySelector("#todayButton").addEventListener("click", () => {
  displayedMonth = startOfMonth(new Date());
  renderCalendar();
});
document.querySelector("#fullscreenButton").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
document.querySelector("#busTimetableButton").addEventListener("click", () => {
  updateBusServiceNotice();
  showTimetable(activeTimetable);
  busDialog.showModal();
});
document.querySelector("#openFullTimetable").addEventListener("click", () => {
  updateBusServiceNotice();
  showTimetable(activeTimetable);
  busDialog.showModal();
});
document.querySelectorAll(".bus-direction-switch button").forEach((button) => {
  button.addEventListener("click", () => {
    homeBusDirection = button.dataset.direction;
    document.querySelectorAll(".bus-direction-switch button").forEach((item) => item.classList.toggle("active", item === button));
    renderNextBuses();
  });
});
document.querySelector("#closeBusDialog").addEventListener("click", () => busDialog.close());
document.querySelectorAll(".timetable-tab").forEach((button) => {
  button.addEventListener("click", () => showTimetable(button.dataset.timetable));
});
busDialog.addEventListener("click", (event) => {
  if (event.target === busDialog) busDialog.close();
});
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

function showTimetable(key) {
  if (!TIMETABLES[key]) return;
  activeTimetable = key;
  const timetable = TIMETABLES[key];
  document.querySelector("#localTimetableTitle").textContent = timetable.title;
  document.querySelector("#localTimetableMeta").textContent = `${timetable.updated}｜${timetable.fare}｜${timetable.notes}`;
  document.querySelectorAll(".timetable-tab").forEach((button) => {
    const selected = button.dataset.timetable === key;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  const groupEntries = Object.entries(timetable.groups);
  const selector = document.querySelector("#scheduleSelector");
  selector.replaceChildren();
  groupEntries.forEach(([groupKey, group], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = group.label;
    button.classList.toggle("active", index === 0);
    button.addEventListener("click", () => {
      selector.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      renderSchedule(groupKey);
    });
    selector.append(button);
  });
  renderSchedule(groupEntries[0][0]);
}

function renderSchedule(groupKey) {
  const group = TIMETABLES[activeTimetable].groups[groupKey];
  const container = document.querySelector("#localTimetable");
  container.replaceChildren(createScheduleColumn(group.outbound), createScheduleColumn(group.inbound));
}

function createScheduleColumn(direction) {
  const column = document.createElement("section");
  column.className = "schedule-column";
  const heading = document.createElement("h4");
  heading.textContent = direction.label;
  column.append(heading);
  const byHour = direction.times.reduce((hours, entry) => {
    const hour = entry.slice(0, 2);
    if (!hours[hour]) hours[hour] = [];
    hours[hour].push(entry);
    return hours;
  }, {});
  Object.entries(byHour)
    .sort(([firstHour], [secondHour]) => Number(firstHour) - Number(secondHour))
    .forEach(([hour, times]) => {
      const row = document.createElement("div");
      row.className = "hour-row";
      const hourLabel = document.createElement("span");
      hourLabel.className = "hour-label";
      hourLabel.textContent = Number(hour);
      const minutes = document.createElement("div");
      minutes.className = "minute-list";
      times.forEach((encoded) => {
        const item = document.createElement("span");
        item.className = "bus-time";
        if (encoded.includes("*")) item.classList.add("direct");
        if (encoded.includes("^")) item.classList.add("ooyake");
        if (encoded.includes("D")) item.classList.add("suspended");
        if (encoded.includes("B")) item.classList.add("break-only");
        item.textContent = encoded.slice(3, 5);
        item.title = [encoded.includes("*") ? "直通・大学発着" : "", encoded.includes("^") ? "大宅中学校発着" : "", encoded.includes("D") ? "学休期運休" : "", encoded.includes("B") ? "学休期のみ運行" : ""].filter(Boolean).join("／");
        minutes.append(item);
      });
      row.append(hourLabel, minutes);
      column.append(row);
    });
  return column;
}

function updateBusServiceNotice() {
  const notice = document.querySelector("#busServiceNotice");
  const now = new Date();
  if (isUniversityBreak(now)) {
    notice.textContent = "学休期ダイヤ期間中：シャトルバスは原則運休です。夏期臨時便をご確認ください。";
    notice.classList.add("important");
  } else {
    notice.textContent = "通常便と臨時便では運行日・時刻が異なります。";
    notice.classList.remove("important");
  }
}

const savedTheme = localStorage.getItem("laboratory-calendar-theme");
const initialTheme = savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.documentElement.dataset.theme = initialTheme;
document.querySelector("#themeButton").textContent = initialTheme === "dark" ? "ライトモード" : "ダークモード";
document.querySelector("#themeButton").setAttribute("aria-pressed", String(initialTheme === "dark"));
updateClock();
loadCurrentUser();
refreshEvents();
renderNextBuses();
setInterval(updateClock, 1000);
setInterval(async () => {
  await refreshEvents();
  renderNextBuses();
}, 30_000);
