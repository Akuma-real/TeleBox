import { Plugin } from "@utils/pluginBase";
import { Api } from "telegram";
import { SudoDB } from "@utils/sudoDB";
import { sleep } from "telegram/Helpers";
import {
  dealCommandPluginWithMessage,
  getCommandFromMessage,
} from "@utils/pluginManager";

// 简单缓存 sudo 用户 ID，减少频繁 IO
let sudoCache = { ids: [] as number[], cids: [] as number[], ts: 0 };
const SUDO_CACHE_TTL = 10_000; // 10s

function withSudoDB<T>(fn: (db: SudoDB) => T): T {
  const db = new SudoDB();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function refreshSudoCache() {
  sudoCache.ids = withSudoDB((db) => db.ls().map((u) => u.uid));
  sudoCache.cids = withSudoDB((db) => db.lsChats().map((u) => u.id));
  sudoCache.ts = Date.now();
}
function getSudoIds() {
  if (Date.now() - sudoCache.ts > SUDO_CACHE_TTL) refreshSudoCache();
  return sudoCache.ids;
}
function getSudoCids() {
  if (Date.now() - sudoCache.ts > SUDO_CACHE_TTL) refreshSudoCache();
  return sudoCache.cids;
}

function extractId(from: any): number | null {
  const raw = from?.chatId || from?.channelId || from?.userId;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildDisplay(id: number, entity: any, isUser: boolean) {
  const parts: string[] = [];
  if (entity?.title) parts.push(entity.title);
  if (entity?.firstName) parts.push(entity.firstName);
  if (entity?.lastName) parts.push(entity.lastName);
  if (entity?.username) parts.push(`@${entity.username}`);
  parts.push(
    isUser
      ? `<a href="tg://user?id=${id}">${id}</a>`
      : `<a href="https://t.me/c/${id}">${id}</a>`
  );
  return parts.join(" ").trim();
}

async function handleAddDel(
  msg: Api.Message,
  target: string,
  action: "add" | "del"
) {
  let entity: any;
  let uid: any;
  let display: any;
  if (target) {
    try {
      entity = await msg.client?.getEntity(target);
      uid = entity?.id;
      if (!uid) {
        await msg.edit({ text: "无法获取用户 ID" });
        return;
      }
      uid = Number(uid);
      display = buildDisplay(uid, entity, entity instanceof Api.User);
    } catch {
      await msg.edit({ text: "无法获取用户信息" });
      return;
    }
  } else {
    if (!msg.isReply) {
      await msg.edit({ text: "请回复目标用户的消息或带上 uid/@username" });
      return;
    }
    const reply = await msg.getReplyMessage();
    if (!reply) {
      await msg.edit({ text: "无法获取回复消息" });
      return;
    }
    uid = extractId(reply.fromId as any);
    if (!uid) {
      await msg.edit({ text: "无法获取用户 ID" });
      return;
    }
    try {
      entity = await msg.client?.getEntity(uid);
    } catch {
      /* ignore */
    }
    display = buildDisplay(uid, entity, !!(reply.fromId as any)?.userId);
  }

  withSudoDB((db) => {
    if (action === "add") db.add(uid, display);
    else db.del(uid);
  });
  sudoCache.ts = 0; // 失效缓存

  await msg.edit({
    text: `已${action === "add" ? "添加" : "删除"}: ${display}`,
    parseMode: "html",
  });
  await sleep(2000);
  await msg.delete();
}

async function handleList(msg: Api.Message) {
  const users = withSudoDB((db) => db.ls());
  if (users.length === 0) {
    await msg.edit({ text: "当前没有任何用户" });
    return;
  }
  await msg.edit({
    text: `当前用户列表：\n${users.map((u) => "- " + u.username).join("\n")}`,
    parseMode: "html",
  });
}
async function handleChatAddDel(
  msg: Api.Message,
  target: any,
  action: "add" | "del"
) {
  let entity: any;
  let cid: any;
  let display: any;
  if (target) {
    try {
      entity = await msg.client?.getEntity(target);
      cid = entity?.id;
      if (!cid) {
        await msg.edit({ text: "无法获取对话 ID" });
        return;
      }
      cid = Number(cid);
      display = buildDisplay(cid, entity, entity instanceof Api.User);
    } catch {
      await msg.edit({ text: "无法获取对话信息" });
      return;
    }
  } else {
    cid = extractId(msg.peerId as any);
    if (!cid) {
      await msg.edit({ text: "无法获取对话 ID" });
      return;
    }
    try {
      entity = await msg.client?.getEntity(cid);
    } catch {
      /* ignore */
    }
    display = buildDisplay(cid, entity, !!(msg.peerId as any)?.userId);
  }

  withSudoDB((db) => {
    if (action === "add") db.addChat(cid, display);
    else db.delChat(cid);
  });
  sudoCache.ts = 0; // 失效缓存

  await msg.edit({
    text: `已${action === "add" ? "添加" : "删除"}: ${display}`,
    parseMode: "html",
  });
  await sleep(2000);
  await msg.delete();
}
async function handleChatList(msg: Api.Message) {
  const chats = withSudoDB((db) => db.lsChats());
  if (chats.length === 0) {
    await msg.edit({ text: "⚠️ 未设置对话白名单, 所有对话中均可使用" });
    return;
  }
  await msg.edit({
    text: `对话白名单列表：\n${chats.map((c) => "- " + c.name).join("\n")}`,
    parseMode: "html",
  });
}

const sudoPlugin: Plugin = {
  command: ["sudo"],
  description: `赋予其他用户使用 bot 权限\n.sudo add (回复目标用户的消息或带上 uid/@username) - 添加用户\n.sudo del (回复目标用户的消息或带上 uid/@username) - 删除用户\n.sudo ls - 列出所有用户\n\n⚠️ 若未设置对话白名单, 所有对话中均可使用\n.sudo chat add (在当前对话中使用 或带上 id/@name) - 添加对话到白名单\n.sudo chat del (在当前对话中使用 或带上 id/@name) - 从白名单删除对话\n.sudo chat ls/list - 列出对话白名单`,
  cmdHandler: async (msg) => {
    const parts = msg.message.trim().split(/\s+/);
    let command = parts[1];
    if (command === "chat") {
      let subCommand = parts[2];
      if (subCommand === "add" || subCommand === "del") {
        await handleChatAddDel(msg, parts[3], subCommand);
        return;
      }
      if (subCommand === "ls" || subCommand === "list") {
        await handleChatList(msg);
        return;
      }
    }
    let target = parts[2];
    if (command === "add" || command === "del") {
      await handleAddDel(msg, target, command);
      return;
    }
    if (command === "ls" || command === "list") {
      await handleList(msg);
      return;
    }
    await msg.edit({
      text: "未知命令, 请使用 <code>.help sudo</code> 查看帮助",
      parseMode: "html",
    });
  },
  listenMessageHandler: async (msg) => {
    const uid = extractId(msg.fromId as any);
    const cid = extractId(msg.peerId as any);
    if (!uid || !cid) return;
    if (!getSudoIds().includes(uid)) return;
    const cids = getSudoCids();
    if (cids.length > 0 && !cids.includes(cid)) return;
    const cmd = await getCommandFromMessage(msg);
    if (!cmd) return;
    const sudoMsg = await msg.client?.sendMessage(msg.peerId, {
      message: msg.message,
      replyTo: msg.replyToMsgId,
    });
    if (sudoMsg) await dealCommandPluginWithMessage({ cmd, msg: sudoMsg });
  },
};

export default sudoPlugin;
