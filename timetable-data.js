// Public portfolio edition: all names and times below are synthetic demo data.
window.BUS_TIMETABLES = {
  yamashina: {
    title: "デモ路線A 中央駅 ⇄ 大学",
    updated: "合成デモデータ",
    fare: "運賃情報なし",
    notes: "実在の交通機関の時刻表ではありません。",
    groups: {
      weekday: {
        label: "平日デモ",
        outbound: { label: "中央駅発 → 大学", times: ["08:00","08:30*D","09:00","10:00","12:00","14:00","16:00"] },
        inbound: { label: "大学発 → 中央駅", times: ["09:15","10:15","12:15","14:15","16:15","18:15"] },
      },
      saturday: {
        label: "土曜日デモ",
        outbound: { label: "中央駅発 → 大学", times: ["09:00","11:00","13:00"] },
        inbound: { label: "大学発 → 中央駅", times: ["10:15","12:15","14:15"] },
      },
    },
  },
  kyoto: {
    title: "デモ路線B 北駅 ⇄ 大学方面",
    updated: "合成デモデータ",
    fare: "運賃情報なし",
    notes: "記号表示を確認するための架空路線です。",
    groups: {
      weekday: {
        label: "平日デモ",
        outbound: { label: "北駅発 → 大学方面", times: ["07:30^O","08:30*D","10:30^O","12:30*D","15:30^O","18:30^O"] },
        inbound: { label: "大学方面発 → 北駅", times: ["08:45^O","09:45*D","11:45^O","13:45*D","16:45^O","19:45^O"] },
      },
      holiday: {
        label: "休日デモ",
        outbound: { label: "北駅発 → 大学方面", times: ["09:30^O","12:30^O","15:30^O"] },
        inbound: { label: "大学方面発 → 北駅", times: ["10:45^O","13:45^O","16:45^O"] },
      },
    },
  },
  shuttle: {
    title: "デモシャトル 交流館 ⇄ 大学",
    updated: "合成デモデータ",
    fare: "無料（デモ表記）",
    notes: "実在の運行情報ではありません。",
    groups: {
      weekday: {
        label: "平日デモ",
        outbound: { label: "交流館発 → 大学", times: ["08:10","08:40","09:10","10:10","12:10","14:10","16:10","18:10"] },
        inbound: { label: "大学発 → 交流館", times: ["08:25","08:55","09:25","10:25","12:25","14:25","16:25","18:25"] },
      },
    },
  },
  summer: {
    title: "デモ臨時シャトル",
    updated: "合成デモデータ",
    fare: "無料（デモ表記）",
    notes: "臨時運行日の表示確認専用です。",
    groups: {
      special: {
        label: "指定デモ日のみ",
        outbound: { label: "交流館発 → 大学", times: ["08:00","09:00","10:00","13:00","15:00"] },
        inbound: { label: "大学発 → 交流館", times: ["08:30","09:30","10:30","13:30","15:30"] },
      },
    },
  },
};
