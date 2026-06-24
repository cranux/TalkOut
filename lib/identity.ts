// 匿名身份:本地存一个 anonId(用于"我的排名"高亮)和昵称。无需登录。

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getAnonId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("talkout_anon");
  if (!id) {
    id = rid();
    localStorage.setItem("talkout_anon", id);
  }
  return id;
}

export function getName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("talkout_name") || "";
}

export function setName(name: string) {
  if (typeof window !== "undefined") localStorage.setItem("talkout_name", name);
}
