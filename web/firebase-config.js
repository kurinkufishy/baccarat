// Firebaseコンソール → プロジェクトの設定 → マイアプリ（ウェブ）に出てくる値をそのまま貼る。
// この値は公開されても大丈夫なもの（守っているのはサーバー側のルールと関数）。
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// Cloud Functions を置いたリージョン（functions/index.js と合わせる）
export const functionsRegion = "asia-northeast1";
