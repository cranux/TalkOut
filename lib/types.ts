// 共享类型定义

export type Emotion = "wary" | "amused" | "annoyed" | "won_over";

/** 一个可玩角色:性格 + 目标 + 隐藏弱点 + 红线 + 说服阈值 */
export interface Character {
  id: string;
  name: string;
  /** 选人页头像(emoji) */
  avatar: string;
  /** 选人页一句话钩子 */
  tagline: string;
  /** 场景一句话介绍,展示给玩家 */
  scene: string;
  /** 玩家本局的目标(它不愿意做的事) */
  goal: string;
  /** 注入模型的角色设定(system prompt 主体) */
  persona: string;
  /** 隐藏弱点:玩家试探到才有效,不展示 */
  softSpot: string;
  /** 红线:踩到当场翻车 */
  redLine: string;
  /** 说服度达到多少算赢 */
  threshold: number;
  /** 单局对话回合上限 */
  maxRounds: number;
  /** 开场白 */
  opener: string;
}

/** 模型每轮返回的结构化结果(扮演角色 + 当裁判,一次调用搞定) */
export interface GuardTurn {
  reply: string;
  emotion: Emotion;
  /** 本轮说服度变化,-20..+20。模型漏填或填错时为 0,且 delta_missing=true */
  persuasion_delta: number;
  /** 模型没给合法数字 → 后端兜底成 0,但前端用这个标记显示"?"而不是 ±0 */
  delta_missing?: boolean;
  /** 是否踩红线 → 直接翻车 */
  redline_hit: boolean;
}

/** 历史里 assistant 行的结构化元数据(本次会话产出的,opener 没有) */
export interface TurnMeta {
  emotion: Emotion;
  persuasion_delta: number;
  redline_hit: boolean;
}

/** 历史对话的一条消息 */
export interface TalkHistoryItem {
  role: "user" | "assistant";
  content: string;
  /** 仅 assistant 行才有。回灌给模型当"我上一轮长这样"的范本,防多轮里漏字段。 */
  meta?: TurnMeta;
}

/** 前端发给后端的请求体 */
export interface TalkRequest {
  characterId: string;
  history: TalkHistoryItem[];
}

export type Outcome = "ongoing" | "won" | "lost_rounds" | "lost_redline";
