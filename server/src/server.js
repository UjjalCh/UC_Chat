import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import pool from "./db.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import chatRouter from "./chat.js";
import conversationsRouter from "./conversations.js";

dotenv.config();

/*
|--------------------------------------------------------------------------
| APP CONFIGURATION
|--------------------------------------------------------------------------
*/

const app = express();

const PORT = process.env.PORT || 5000;

const CLIENT_URL =
  process.env.CLIENT_URL ||
  "http://localhost:5173";

const JWT_SECRET = process.env.JWT_SECRET;

/*
|--------------------------------------------------------------------------
| VALIDATE ENVIRONMENT
|--------------------------------------------------------------------------
*/

if (!JWT_SECRET) {
  console.error(
    "ERROR: JWT_SECRET is not configured in server/.env"
  );
}

/*
|--------------------------------------------------------------------------
| HTTP SERVER
|--------------------------------------------------------------------------
*/

const httpServer = http.createServer(app);

/*
|--------------------------------------------------------------------------
| SOCKET.IO
|--------------------------------------------------------------------------
*/

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

/*
|--------------------------------------------------------------------------
| MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| BASIC API TEST
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "UC Chat API is running",
    version: "1.0.0"
  });
});

/*
|--------------------------------------------------------------------------
| AUTH ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/auth",
  authRouter
);

/*
|--------------------------------------------------------------------------
| USER ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/users",
  usersRouter
);

/*
|--------------------------------------------------------------------------
| CHAT ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/chat",
  chatRouter
);

/*
|--------------------------------------------------------------------------
| CONVERSATION ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/conversations",
  conversationsRouter
);

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  async (req, res) => {
    try {
      const [rows] =
        await pool.query(
          "SELECT 1 AS connected"
        );

      res.json({
        ok: true,
        message:
          "UC Chat API is running",
        database:
          rows[0].connected === 1,
        timestamp:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        "Database error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Database connection failed",
        error: error.message,
        code: error.code
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SOCKET AUTHENTICATION
|--------------------------------------------------------------------------
|
| Reads the JWT from the same cookie used by auth.js:
|
| uc_chat_token
|
*/

io.use(
  async (socket, next) => {
    try {
      if (!JWT_SECRET) {
        return next(
          new Error(
            "JWT_SECRET is not configured"
          )
        );
      }

      const cookieHeader =
        socket.handshake.headers.cookie ||
        "";

      const match =
        cookieHeader.match(
          /(?:^|;\s*)uc_chat_token=([^;]+)/
        );

      if (!match) {
        console.error(
          "Socket authentication failed: token cookie not found"
        );

        return next(
          new Error(
            "Not authenticated"
          )
        );
      }

      const token =
        decodeURIComponent(
          match[1]
        );

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      if (!decoded?.id) {
        return next(
          new Error(
            "Invalid authentication token"
          )
        );
      }

      const [users] =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            profile_picture,
            is_online,
            last_seen

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [decoded.id]
        );

      if (users.length === 0) {
        return next(
          new Error(
            "User not found"
          )
        );
      }

      socket.user =
        users[0];

      next();
    } catch (error) {
      console.error(
        "Socket authentication error:",
        error.message
      );

      next(
        new Error(
          "Socket authentication failed"
        )
      );
    }
  }
);

/*
|--------------------------------------------------------------------------
| SOCKET CONNECTION
|--------------------------------------------------------------------------
*/

io.on(
  "connection",
  async (socket) => {
    const user =
      socket.user;

    console.log(
      `Socket connected: ${user.full_name} (${user.id})`
    );

    /*
    |--------------------------------------------------------------------------
    | PERSONAL USER ROOM
    |--------------------------------------------------------------------------
    */

    socket.join(
      `user:${user.id}`
    );

    /*
    |--------------------------------------------------------------------------
    | MARK USER ONLINE
    |--------------------------------------------------------------------------
    */

    try {
      await pool.query(
        `
        UPDATE users

        SET
          is_online = 1

        WHERE id = ?
        `,
        [user.id]
      );

      console.log(
        `User ${user.full_name} is now ONLINE`
      );
    } catch (error) {
      console.error(
        "Unable to mark user online:",
        error
      );
    }

    /*
    |--------------------------------------------------------------------------
    | BROADCAST ONLINE STATUS
    |--------------------------------------------------------------------------
    */

    io.emit(
      "user_status_changed",
      {
        user_id: user.id,
        is_online: true,
        last_seen: null
      }
    );

    /*
    |--------------------------------------------------------------------------
    | JOIN CONVERSATION
    |--------------------------------------------------------------------------
    */

    socket.on(
      "join_conversation",
      async (conversationId) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(id) ||
            id <= 0
          ) {
            return;
          }

          const [rows] =
            await pool.query(
              `
              SELECT
                id

              FROM conversations

              WHERE id = ?

              AND (
                user_one_id = ?
                OR user_two_id = ?
              )

              LIMIT 1
              `,
              [
                id,
                user.id,
                user.id
              ]
            );

          if (
            rows.length === 0
          ) {
            console.log(
              `Unauthorized conversation join attempt by user ${user.id}`
            );

            return;
          }

          socket.join(
            `conversation:${id}`
          );

          console.log(
            `${user.full_name} joined conversation ${id}`
          );
        } catch (error) {
          console.error(
            "Join conversation error:",
            error
          );
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | LEAVE CONVERSATION
    |--------------------------------------------------------------------------
    */

    socket.on(
      "leave_conversation",
      (conversationId) => {
        const id =
          Number(
            conversationId
          );

        if (
          !Number.isInteger(id) ||
          id <= 0
        ) {
          return;
        }

        socket.leave(
          `conversation:${id}`
        );

        console.log(
          `${user.full_name} left conversation ${id}`
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | SEND MESSAGE
    |--------------------------------------------------------------------------
    */

    socket.on(
      "send_message",
      async (
        data,
        callback
      ) => {
        try {
          const conversationId =
            Number(
              data?.conversation_id
            );

          const message =
            String(
              data?.message || ""
            ).trim();

          const messageType =
            data?.message_type ||
            "text";

          /*
          |----------------------------------------------------------------------
          | VALIDATE CONVERSATION ID
          |----------------------------------------------------------------------
          */

          if (
            !Number.isInteger(
              conversationId
            ) ||
            conversationId <= 0
          ) {
            throw new Error(
              "Invalid conversation"
            );
          }

          /*
          |----------------------------------------------------------------------
          | VALIDATE MESSAGE
          |----------------------------------------------------------------------
          */

          if (!message) {
            throw new Error(
              "Message cannot be empty"
            );
          }

          if (
            message.length > 5000
          ) {
            throw new Error(
              "Message is too long"
            );
          }

          /*
          |----------------------------------------------------------------------
          | VALIDATE MESSAGE TYPE
          |----------------------------------------------------------------------
          */

          const allowedTypes = [
            "text",
            "image",
            "file"
          ];

          if (
            !allowedTypes.includes(
              messageType
            )
          ) {
            throw new Error(
              "Invalid message type"
            );
          }

          /*
          |----------------------------------------------------------------------
          | VERIFY CONVERSATION ACCESS
          |----------------------------------------------------------------------
          */

          const [
            conversation
          ] =
            await pool.query(
              `
              SELECT
                id,
                user_one_id,
                user_two_id

              FROM conversations

              WHERE id = ?

              AND (
                user_one_id = ?
                OR user_two_id = ?
              )

              LIMIT 1
              `,
              [
                conversationId,
                user.id,
                user.id
              ]
            );

          if (
            conversation.length === 0
          ) {
            throw new Error(
              "Conversation not found"
            );
          }

          /*
          |----------------------------------------------------------------------
          | SAVE MESSAGE
          |----------------------------------------------------------------------
          */

          const [result] =
            await pool.query(
              `
              INSERT INTO messages
              (
                conversation_id,
                sender_id,
                message,
                message_type
              )

              VALUES (?, ?, ?, ?)
              `,
              [
                conversationId,
                user.id,
                message,
                messageType
              ]
            );

          /*
          |----------------------------------------------------------------------
          | GET SAVED MESSAGE
          |----------------------------------------------------------------------
          */

          const [messages] =
            await pool.query(
              `
              SELECT
                m.id,
                m.conversation_id,
                m.sender_id,
                m.message,
                m.message_type,
                m.is_read,
                m.created_at,

                u.full_name
                  AS sender_name,

                u.email
                  AS sender_email,

                u.profile_picture
                  AS sender_picture

              FROM messages m

              JOIN users u
                ON u.id = m.sender_id

              WHERE m.id = ?

              LIMIT 1
              `,
              [result.insertId]
            );

          if (
            messages.length === 0
          ) {
            throw new Error(
              "Message was saved but could not be loaded"
            );
          }

          const savedMessage =
            messages[0];

          /*
          |----------------------------------------------------------------------
          | SEND MESSAGE TO CONVERSATION
          |----------------------------------------------------------------------
          */

          io
            .to(
              `conversation:${conversationId}`
            )
            .emit(
              "new_message",
              savedMessage
            );

          /*
          |----------------------------------------------------------------------
          | FIND OTHER USER
          |----------------------------------------------------------------------
          */

          const currentConversation =
            conversation[0];

          const otherUserId =
            Number(
              currentConversation.user_one_id
            ) ===
            Number(user.id)
              ? currentConversation.user_two_id
              : currentConversation.user_one_id;

          /*
          |----------------------------------------------------------------------
          | NOTIFY OTHER USER
          |----------------------------------------------------------------------
          */

          io
            .to(
              `user:${otherUserId}`
            )
            .emit(
              "conversation_updated",
              {
                conversation_id:
                  conversationId,

                message:
                  savedMessage
              }
            );

          /*
          |----------------------------------------------------------------------
          | CALLBACK
          |----------------------------------------------------------------------
          */

          if (
            typeof callback ===
            "function"
          ) {
            callback({
              ok: true,
              message:
                savedMessage
            });
          }
        } catch (error) {
          console.error(
            "Socket message error:",
            error
          );

          if (
            typeof callback ===
            "function"
          ) {
            callback({
              ok: false,
              message:
                error.message ||
                "Unable to send message"
            });
          }
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | TYPING
    |--------------------------------------------------------------------------
    */

    socket.on(
      "typing",
      async (conversationId) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(id) ||
            id <= 0
          ) {
            return;
          }

          const [rows] =
            await pool.query(
              `
              SELECT
                id

              FROM conversations

              WHERE id = ?

              AND (
                user_one_id = ?
                OR user_two_id = ?
              )

              LIMIT 1
              `,
              [
                id,
                user.id,
                user.id
              ]
            );

          if (
            rows.length === 0
          ) {
            return;
          }

          socket
            .to(
              `conversation:${id}`
            )
            .emit(
              "user_typing",
              {
                user_id:
                  user.id,

                full_name:
                  user.full_name
              }
            );
        } catch (error) {
          console.error(
            "Typing error:",
            error
          );
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | STOP TYPING
    |--------------------------------------------------------------------------
    */

    socket.on(
      "stop_typing",
      async (conversationId) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(id) ||
            id <= 0
          ) {
            return;
          }

          const [rows] =
            await pool.query(
              `
              SELECT
                id

              FROM conversations

              WHERE id = ?

              AND (
                user_one_id = ?
                OR user_two_id = ?
              )

              LIMIT 1
              `,
              [
                id,
                user.id,
                user.id
              ]
            );

          if (
            rows.length === 0
          ) {
            return;
          }

          socket
            .to(
              `conversation:${id}`
            )
            .emit(
              "user_stop_typing",
              {
                user_id:
                  user.id
              }
            );
        } catch (error) {
          console.error(
            "Stop typing error:",
            error
          );
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | DISCONNECT
    |--------------------------------------------------------------------------
    */

    socket.on(
      "disconnect",
      async (reason) => {
        console.log(
          `Socket disconnected: ${user.full_name} (${user.id}) - ${reason}`
        );

        try {
          /*
          |--------------------------------------------------------------------
          | IMPORTANT
          |--------------------------------------------------------------------
          | Check whether this user still has another active socket.
          | This prevents multiple browser tabs from incorrectly changing
          | the user to OFFLINE.
          |--------------------------------------------------------------------
          */

          const userRoom =
            io.sockets.adapter.rooms.get(
              `user:${user.id}`
            );

          const remainingConnections =
            userRoom
              ? userRoom.size
              : 0;

          /*
          |--------------------------------------------------------------------
          | ONLY MARK OFFLINE WHEN NO SOCKETS REMAIN
          |--------------------------------------------------------------------
          */

          if (
            remainingConnections === 0
          ) {
            await pool.query(
              `
              UPDATE users

              SET
                is_online = 0,
                last_seen =
                  CURRENT_TIMESTAMP

              WHERE id = ?
              `,
              [user.id]
            );

            console.log(
              `User ${user.full_name} is now OFFLINE`
            );

            /*
            |------------------------------------------------------------------
            | BROADCAST OFFLINE STATUS
            |------------------------------------------------------------------
            */

            io.emit(
              "user_status_changed",
              {
                user_id:
                  user.id,

                is_online:
                  false,

                last_seen:
                  new Date()
              }
            );
          } else {
            console.log(
              `User ${user.full_name} still has ${remainingConnections} active connection(s)`
            );
          }
        } catch (error) {
          console.error(
            "Unable to update offline status:",
            error
          );
        }
      }
    );
  }
);

/*
|--------------------------------------------------------------------------
| 404 HANDLER
|--------------------------------------------------------------------------
*/

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      message:
        "API route not found",
      path:
        req.originalUrl
    });
  }
);

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res.status(500).json({
      ok: false,
      message:
        "Internal server error"
    });
  }
);

/*
|--------------------------------------------------------------------------
| SERVER ERROR HANDLING
|--------------------------------------------------------------------------
*/

httpServer.on(
  "error",
  (error) => {
    if (
      error.code ===
      "EADDRINUSE"
    ) {
      console.error("");
      console.error(
        `ERROR: Port ${PORT} is already in use.`
      );
      console.error(
        `Close the other server using port ${PORT}, then run npm run dev again.`
      );
      console.error("");

      process.exit(1);
    }

    console.error(
      "HTTP server error:",
      error
    );

    process.exit(1);
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      "          UC CHAT SERVER STARTED"
    );

    console.log(
      "========================================"
    );

    console.log(
      `API:       http://localhost:${PORT}`
    );

    console.log(
      `Health:    http://localhost:${PORT}/api/health`
    );

    console.log(
      `Client:    ${CLIENT_URL}`
    );

    console.log(
      `Socket.IO: port ${PORT}`
    );

    console.log(
      "Authentication: ENABLED"
    );

    console.log(
      "Online status:  ENABLED"
    );

    console.log(
      "Last seen:      ENABLED"
    );

    console.log(
      "Typing status:  ENABLED"
    );

    console.log(
      "========================================"
    );

    console.log("");
  }
);