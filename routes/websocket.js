/**
 * websocket 相关的路由
 * @File   : websocket.js
 * @Author : Richard (xiaowei.hsueh@gmail.com)
 * @Link   : http://www.gistop.com/
 * @Date   : 2018-6-18 13:49:58
 */

const jwt = require('jsonwebtoken');
const router = require('koa-router');
const MongoDB = require('mongodb');

const UserModel = require('../models/user');
const MessageModel = require('../models/message');
const configs = require('../configs');

const MongoClient = MongoDB.MongoClient;

const createMongoClient = options => {
  const defaultOptions = {
    host: 'localhost',
    port: 27017,
    db: 'test',
    max: 100,
    min: 1
  };
  options = Object.assign({}, defaultOptions, options);
  let mongoUrl = options.uri || options.url;
  if (!mongoUrl) {
    if (options.user && options.pass) {
      mongoUrl = `mongodb://${options.user}:${options.pass}@${options.host}:${options.port}/${options.db}`;
    } else {
      mongoUrl = `mongodb://${options.host}:${options.port}/${options.db}`;
    }
  }
  return MongoClient.connect(mongoUrl);
};

let mongo;
createMongoClient(configs.mongodb).then(client => { mongo = client; });
const websocket = router();
const sockets = new Map();
const verify = (...args) => {
  return new Promise((resolve, reject) => {
    jwt.verify(...args, (error, decoded) => {
      error ? reject(error) : resolve(decoded);
    });
  });
};

websocket.get('/wechat/:token', async(ctx, next) => {
  const { token } = ctx.params;
  const { secret } = configs;
  const user = await verify(token, secret, { ignoreExpiration: true });
  ctx.mongo = mongo;
  // 已经登录通过难
  if (user) {
    const { phone } = user;
    sockets.set(phone, ctx.websocket);
    await sendInitialData(ctx, user);
    ctx.websocket.on('message', message => {
      const msg = JSON.parse(message);
      const { type } = msg;
      switch (type) {
        case 'candidate':
          sendCandidate(ctx, user, msg);
          break;
        case 'message':
          sendMessage(ctx, user, msg);
          break;
        default:
          break;
      }
    });
    ctx.websocket.on('close', () => {
      sockets.delete(phone);
    });
  } else {
    // 未登录的情况直接关闭socket链接
    ctx.websocket.close();
  }
  await next();
});

/**
 * 发送视频请求
 * @param {object} ctx 请求上下文
 * @param {object} user 发送的用户
 * @param {object} msg 请求信息
 */
const sendCandidate = (ctx, user, msg) => {
  const { payload } = msg;
  const { phone, candidate } = payload;
  const targetSocket = sockets.get(phone);
  if (targetSocket) {
    targetSocket.send(JSON.stringify({
      user,
      candidate
    }));
  } else {
    // 保存离线消息
    saveOfflineMessage(ctx, user, {
      type: 'message',
      payload: {
        phone: phone,
        message: 'video-chat-request'
      }
    });
  }
};

/**
 * 消息处理
 * @param {object} ctx, 请求上下文
 * @param {object} user 发送的用户
 * @param {string} msg 消息内容
 */
const sendMessage = (ctx, user, msg) => {
  const { payload } = msg;
  const { phone, message } = payload;
  const targetSocket = sockets.get(phone);
  if (targetSocket) {
    targetSocket.send({
      type: 'message',
      payload: {
        user,
        message
      }
    });
  } else { // 保存离线消息
    saveOfflineMessage(ctx, user, msg);
  }
};

/**
 * 发送初始化数据
 * @param {Application} ctx 上下文对象
 */
const sendInitialData = async(ctx, user) => {
  const userModel = new UserModel(ctx, user);
  const conversations = await userModel.getConversationList();
  ctx.websocket.send(JSON.stringify({
    type: 'wechat/save',
    payload: {
      conversations
    }
  }));
  const contacts = await userModel.getContactList();
  ctx.websocket.send(JSON.stringify({
    type: 'wechat/save',
    payload: {
      contacts
    }
  }));
};

/**
 * 保存离线消息
 * @param {object} ctx 上下文
 * @param {object} user 当前会话用户
 * @param {object} msg 消息对象
 */
const saveOfflineMessage = async(ctx, user, msg) => {
  const now = new Date();
  const { payload } = msg;
  const { phone, message } = payload;
  const messageModel = new MessageModel(ctx);
  const selector = {
    to: phone
  };
  const document = {
    $set: {
      date: now,
      message
    },
    $inc: {
      count: 1
    }
  };
  const options = {
    insert: true,
    multi: false
  };
  messageModel.update(selector, document, options);
};

module.exports = websocket;
