"use strict";

const { createAccountAuthService } = require("./account-auth.js");

function installAccountAuth(io, options = {}) {
  if (!io || typeof io.on !== "function") return null;
  if (io.__ptitBacAccountAuthInstalled) return io.__ptitBacAccountAuthInstalled;

  const service = options.service || createAccountAuthService(options);

  function reply(ack, payload) {
    if (typeof ack === "function") ack(payload);
  }

  async function run(ack, action) {
    try {
      reply(ack, await action());
    } catch (error) {
      console.error("Compte joueur:", error?.message || error);
      reply(ack, {
        ok:false,
        error:"Le service de compte est momentanément indisponible."
      });
    }
  }

  const connectionHandler = socket => {
    socket.on("auth:register", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.register(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:login", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.login(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:resume", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.resume(payload);
        if (result?.ok && result.account) {
          socket.data.accountUserId = result.account.userId;
          socket.data.accountWalletToken = result.account.walletToken;
        }
        return result;
      });
    });

    socket.on("auth:logout", (payload = {}, ack) => {
      run(ack, async () => {
        const result = await service.logout(payload);
        socket.data.accountUserId = "";
        socket.data.accountWalletToken = "";
        return result;
      });
    });
  };

  io.on("connection", connectionHandler);

  const installed = { service, connectionHandler };
  io.__ptitBacAccountAuthInstalled = installed;
  return installed;
}

module.exports = installAccountAuth;
