import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import pool, {
  testDatabaseConnection,
  closeDatabase,
} from "./db.js";

import authRouter from "./auth.js";
import usersRouter from "./users.js";
import chatRouter from "./chat.js";
import conversationsRouter from "./conversations.js";

dotenv.config();

/*
|--------------------------------------------------------------------------
| FILE PATH CONFIGURATION
|--------------------------------------------------------------------------
*/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDirectory = path.join(
  __dirname,
  "../uploads"
);

if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, {
    recursive: true,
  });
}

/*
|--------------------------------------------------------------------------
| APPLICATION CONFIGURATION
|--------------------------------------------------------------------------
*/

const app = express();

const httpServer = http.createServer(app);

const PORT =
  Number(process.env.PORT) || 5000;

const CLIENT_URL =
  process.env.CLIENT_URL ||
  "http://localhost:5173";

const SERVER_URL =
  process.env.SERVER_URL ||
  `http://localhost:${PORT}`;

const JWT_SECRET =
  process.env.JWT_SECRET;

/*
|--------------------------------------------------------------------------
| ALLOWED FRONTEND ORIGINS
|--------------------------------------------------------------------------
*/

const allowedOrigins = [
  CLIENT_URL,

  "http://localhost:5173",

  "http://127.0.0.1:5173",

  "https://uc-chat-wheat.vercel.app",
].filter(Boolean);

/*
|--------------------------------------------------------------------------
| ENVIRONMENT VALIDATION
|--------------------------------------------------------------------------
*/

if (!JWT_SECRET) {
  console.error(
    "ERROR: JWT_SECRET is not configured."
  );
}

if (!process.env.DB_HOST) {
  console.warn(
    "WARNING: DB_HOST is not configured."
  );
}

if (!process.env.DB_USER) {
  console.warn(
    "WARNING: DB_USER is not configured."
  );
}

if (!process.env.DB_NAME) {
  console.warn(
    "WARNING: DB_NAME is not configured."
  );
}

/*
|--------------------------------------------------------------------------
| CONFIGURATION LOG
|--------------------------------------------------------------------------
*/

console.log("");
console.log(
  "========================================"
);
console.log(
  "           UC CHAT CONFIGURATION"
);
console.log(
  "========================================"
);

console.log(
  "NODE_ENV:",
  process.env.NODE_ENV || "development"
);

console.log(
  "PORT:",
  PORT
);

console.log(
  "CLIENT_URL:",
  CLIENT_URL
);

console.log(
  "SERVER_URL:",
  SERVER_URL
);

console.log(
  "Allowed origins:",
  allowedOrigins
);

console.log(
  "JWT_SECRET:",
  JWT_SECRET
    ? "CONFIGURED"
    : "MISSING"
);

console.log(
  "DB_HOST:",
  process.env.DB_HOST || "MISSING"
);

console.log(
  "DB_NAME:",
  process.env.DB_NAME || "MISSING"
);

console.log(
  "UPLOAD DIRECTORY:",
  uploadDirectory
);

console.log(
  "========================================"
);

console.log("");

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin: (origin, callback) => {
      /*
      |----------------------------------------------------------------------
      | Allow requests such as Postman/server-side requests that have
      | no Origin header.
      |----------------------------------------------------------------------
      */

      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      console.error(
        "CORS blocked origin:",
        origin
      );

      return callback(
        new Error(
          "Not allowed by CORS"
        )
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

/*
|--------------------------------------------------------------------------
| BODY PARSERS
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: "20mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "20mb",
  })
);

/*
|--------------------------------------------------------------------------
| COOKIE PARSER
|--------------------------------------------------------------------------
*/

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| STATIC UPLOAD FILES
|--------------------------------------------------------------------------
*/

app.use(
  "/uploads",
  express.static(uploadDirectory)
);

/*
|--------------------------------------------------------------------------
| REQUEST LOGGER
|--------------------------------------------------------------------------
*/

app.use(
  (req, res, next) => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl}`
    );

    next();
  }
);

/*
|--------------------------------------------------------------------------
| MULTER CONFIGURATION
|--------------------------------------------------------------------------
*/

const allowedMimeTypes = [
  /*
  | Images
  */

  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",

  /*
  | Documents
  */

  "application/pdf",
  "text/plain",

  /*
  | Archives
  */

  "application/zip",

  /*
  | Microsoft Word
  */

  "application/msword",

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  /*
  | Microsoft Excel
  */

  "application/vnd.ms-excel",

  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

  /*
  | Microsoft PowerPoint
  */

  "application/vnd.ms-powerpoint",

  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const storage =
  multer.diskStorage({
    destination: (
      req,
      file,
      cb
    ) => {
      cb(
        null,
        uploadDirectory
      );
    },

    filename: (
      req,
      file,
      cb
    ) => {
      const extension =
        path.extname(
          file.originalname
        );

      const baseName =
        path
          .basename(
            file.originalname,
            extension
          )
          .replace(
            /[^a-zA-Z0-9-_]/g,
            "_"
          );

      const uniqueName =
        `${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}-${baseName}${extension}`;

      cb(
        null,
        uniqueName
      );
    },
  });

const upload =
  multer({
    storage,

    limits: {
      fileSize:
        15 * 1024 * 1024,
    },

    fileFilter: (
      req,
      file,
      cb
    ) => {
      if (
        allowedMimeTypes.includes(
          file.mimetype
        )
      ) {
        cb(null, true);
      } else {
        cb(
          new Error(
            "This file type is not supported."
          )
        );
      }
    },
  });

/*
|--------------------------------------------------------------------------
| SOCKET.IO
|--------------------------------------------------------------------------
*/

const io =
  new Server(
    httpServer,
    {
      cors: {
        origin:
          allowedOrigins,

        credentials: true,

        methods: [
          "GET",
          "POST",
        ],
      },

      transports: [
        "websocket",
        "polling",
      ],

      maxHttpBufferSize:
        2 * 1024 * 1024,
    }
  );

/*
|--------------------------------------------------------------------------
| BASIC API TEST
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {
    return res.json({
      ok: true,

      message:
        "UC Chat API is running",

      version:
        "1.2.0",

      environment:
        process.env.NODE_ENV ||
        "development",

      features: {
        authentication: true,
        text_messages: true,
        image_messages: true,
        file_messages: true,
        image_upload: true,
        file_upload: true,
        socket_io: true,
        online_status: true,
        last_seen: true,
        typing_status: true,
        conversations: true,
      },
    });
  }
);

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
| FILE UPLOAD
| POST /api/chat/upload
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This route is registered BEFORE the 404 handler.
|--------------------------------------------------------------------------
*/

app.post(
  "/api/chat/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      /*
      |----------------------------------------------------------------------
      | JWT CONFIGURATION
      |----------------------------------------------------------------------
      */

      if (!JWT_SECRET) {
        return res.status(500).json({
          ok: false,
          message:
            "JWT_SECRET is not configured",
        });
      }

      /*
      |----------------------------------------------------------------------
      | READ TOKEN COOKIE
      |----------------------------------------------------------------------
      */

      const cookieHeader =
        req.headers.cookie || "";

      const tokenMatch =
        cookieHeader.match(
          /(?:^|;\s*)uc_chat_token=([^;]+)/
        );

      if (!tokenMatch) {
        return res.status(401).json({
          ok: false,
          message:
            "Not authenticated",
        });
      }

      const token =
        decodeURIComponent(
          tokenMatch[1]
        );

      /*
      |----------------------------------------------------------------------
      | VERIFY TOKEN
      |----------------------------------------------------------------------
      */

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      if (
        !decoded ||
        !decoded.id
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authentication token",
        });
      }

      /*
      |----------------------------------------------------------------------
      | CHECK USER
      |----------------------------------------------------------------------
      */

      const [users] =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            profile_picture

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [decoded.id]
        );

      if (
        users.length === 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "User not found",
        });
      }

      /*
      |----------------------------------------------------------------------
      | CHECK FILE
      |----------------------------------------------------------------------
      */

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message:
            "No file selected",
        });
      }

      /*
      |----------------------------------------------------------------------
      | DETERMINE MESSAGE TYPE
      |----------------------------------------------------------------------
      */

      const isImage =
        req.file.mimetype.startsWith(
          "image/"
        );

      const messageType =
        isImage
          ? "image"
          : "file";

      /*
      |----------------------------------------------------------------------
      | CREATE FILE URL
      |----------------------------------------------------------------------
      */

      const fileUrl =
        `${SERVER_URL}/uploads/${encodeURIComponent(
          req.file.filename
        )}`;

      /*
      |----------------------------------------------------------------------
      | RESPONSE
      |----------------------------------------------------------------------
      */

      return res.status(201).json({
        ok: true,

        message:
          "File uploaded successfully",

        file: {
          url: fileUrl,

          filename:
            req.file.filename,

          original_name:
            req.file.originalname,

          mimetype:
            req.file.mimetype,

          size:
            req.file.size,

          message_type:
            messageType,
        },
      });
    } catch (error) {
      console.error(
        "File upload error:",
        error
      );

      /*
      |----------------------------------------------------------------------
      | DELETE PARTIALLY UPLOADED FILE
      |----------------------------------------------------------------------
      */

      if (
        req.file &&
        req.file.path
      ) {
        try {
          if (
            fs.existsSync(
              req.file.path
            )
          ) {
            fs.unlinkSync(
              req.file.path
            );
          }
        } catch (
          deleteError
        ) {
          console.error(
            "Unable to remove uploaded file:",
            deleteError
          );
        }
      }

      /*
      |----------------------------------------------------------------------
      | MULTER ERROR
      |----------------------------------------------------------------------
      */

      if (
        error instanceof
        multer.MulterError
      ) {
        if (
          error.code ===
          "LIMIT_FILE_SIZE"
        ) {
          return res.status(413).json({
            ok: false,
            message:
              "File is too large. Maximum size is 15MB.",
          });
        }

        return res.status(400).json({
          ok: false,
          message:
            error.message,
        });
      }

      /*
      |----------------------------------------------------------------------
      | FILE TYPE ERROR
      |----------------------------------------------------------------------
      */

      if (
        error.message ===
        "This file type is not supported."
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "This file type is not supported.",
        });
      }

      /*
      |----------------------------------------------------------------------
      | JWT ERROR
      |----------------------------------------------------------------------
      */

      if (
        error.name ===
        "JsonWebTokenError"
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authentication token",
        });
      }

      if (
        error.name ===
        "TokenExpiredError"
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Authentication token expired",
        });
      }

      /*
      |----------------------------------------------------------------------
      | GENERAL ERROR
      |----------------------------------------------------------------------
      */

      return res.status(500).json({
        ok: false,

        message:
          "Unable to upload file",

        error:
          process.env.NODE_ENV ===
          "production"
            ? undefined
            : error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| DATABASE HEALTH CHECK
| GET /api/health
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

      return res.json({
        ok: true,

        message:
          "UC Chat API is running",

        database:
          Number(
            rows[0]?.connected
          ) === 1,

        timestamp:
          new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "Database health error:",
        error
      );

      return res.status(500).json({
        ok: false,

        message:
          "Database connection failed",

        code:
          error.code,

        error:
          process.env.NODE_ENV ===
          "production"
            ? undefined
            : error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SOCKET AUTHENTICATION
|--------------------------------------------------------------------------
*/

io.use(
  async (
    socket,
    next
  ) => {
    try {
      if (!JWT_SECRET) {
        return next(
          new Error(
            "JWT_SECRET is not configured"
          )
        );
      }

      /*
      |----------------------------------------------------------------------
      | GET COOKIE
      |----------------------------------------------------------------------
      */

      const cookieHeader =
        socket.handshake
          .headers
          .cookie || "";

      const tokenMatch =
        cookieHeader.match(
          /(?:^|;\s*)uc_chat_token=([^;]+)/
        );

      if (!tokenMatch) {
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
          tokenMatch[1]
        );

      /*
      |----------------------------------------------------------------------
      | VERIFY JWT
      |----------------------------------------------------------------------
      */

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      if (
        !decoded ||
        !decoded.id
      ) {
        return next(
          new Error(
            "Invalid authentication token"
          )
        );
      }

      /*
      |----------------------------------------------------------------------
      | CHECK USER
      |----------------------------------------------------------------------
      */

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

      if (
        users.length === 0
      ) {
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
    |----------------------------------------------------------------------
    | PERSONAL USER ROOM
    |----------------------------------------------------------------------
    */

    const userRoom =
      `user:${user.id}`;

    socket.join(
      userRoom
    );

    /*
    |----------------------------------------------------------------------
    | MARK USER ONLINE
    |----------------------------------------------------------------------
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
    |----------------------------------------------------------------------
    | BROADCAST ONLINE STATUS
    |----------------------------------------------------------------------
    */

    io.emit(
      "user_status_changed",
      {
        user_id:
          user.id,

        is_online:
          true,

        last_seen:
          null,
      }
    );

    /*
    |----------------------------------------------------------------------
    | JOIN CONVERSATION
    |----------------------------------------------------------------------
    */

    socket.on(
      "join_conversation",
      async (
        conversationId
      ) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(
              id
            ) ||
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
                user.id,
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
    |----------------------------------------------------------------------
    | LEAVE CONVERSATION
    |----------------------------------------------------------------------
    */

    socket.on(
      "leave_conversation",
      (
        conversationId
      ) => {
        const id =
          Number(
            conversationId
          );

        if (
          !Number.isInteger(
            id
          ) ||
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
    |----------------------------------------------------------------------
    | SEND MESSAGE
    |----------------------------------------------------------------------
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
            String(
              data?.message_type ||
                "text"
            );

          /*
          |------------------------------------------------------------------
          | VALIDATE CONVERSATION
          |------------------------------------------------------------------
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
          |------------------------------------------------------------------
          | VALIDATE MESSAGE
          |------------------------------------------------------------------
          */

          if (!message) {
            throw new Error(
              "Message cannot be empty"
            );
          }

          /*
          |------------------------------------------------------------------
          | VALID MESSAGE TYPES
          |------------------------------------------------------------------
          */

          const allowedTypes = [
            "text",
            "image",
            "file",
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
          |------------------------------------------------------------------
          | TEXT LENGTH
          |------------------------------------------------------------------
          */

          if (
            messageType === "text" &&
            message.length > 5000
          ) {
            throw new Error(
              "Text message is too long"
            );
          }

          /*
          |------------------------------------------------------------------
          | IMAGE / FILE URL
          |------------------------------------------------------------------
          */

          if (
            messageType === "image" ||
            messageType === "file"
          ) {
            if (
              !message.startsWith(
                "http://"
              ) &&
              !message.startsWith(
                "https://"
              )
            ) {
              throw new Error(
                "Invalid uploaded file URL"
              );
            }
          }

          /*
          |------------------------------------------------------------------
          | CHECK CONVERSATION ACCESS
          |------------------------------------------------------------------
          */

          const [
            conversations,
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
                user.id,
              ]
            );

          if (
            conversations.length === 0
          ) {
            throw new Error(
              "Conversation not found"
            );
          }

          const conversation =
            conversations[0];

          /*
          |------------------------------------------------------------------
          | INSERT MESSAGE
          |------------------------------------------------------------------
          */

          const [
            result,
          ] =
            await pool.query(
              `
              INSERT INTO messages
              (
                conversation_id,
                sender_id,
                message,
                message_type,
                is_read
              )

              VALUES (?, ?, ?, ?, FALSE)
              `,
              [
                conversationId,
                user.id,
                message,
                messageType,
              ]
            );

          /*
          |------------------------------------------------------------------
          | UPDATE CONVERSATION
          |------------------------------------------------------------------
          */

          await pool.query(
            `
            UPDATE conversations

            SET
              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = ?
            `,
            [conversationId]
          );

          /*
          |------------------------------------------------------------------
          | LOAD SAVED MESSAGE
          |------------------------------------------------------------------
          */

          const [
            messages,
          ] =
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

              INNER JOIN users u
                ON u.id =
                  m.sender_id

              WHERE
                m.id = ?

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
          |------------------------------------------------------------------
          | NORMALIZE is_read
          |------------------------------------------------------------------
          */

          savedMessage.is_read =
            Number(
              savedMessage.is_read
            ) === 1
              ? 1
              : 0;

          /*
          |------------------------------------------------------------------
          | SEND TO CONVERSATION
          |------------------------------------------------------------------
          */

          io.to(
            `conversation:${conversationId}`
          ).emit(
            "new_message",
            savedMessage
          );

          /*
          |------------------------------------------------------------------
          | FIND OTHER USER
          |------------------------------------------------------------------
          */

          const otherUserId =
            Number(
              conversation.user_one_id
            ) ===
            Number(user.id)
              ? conversation.user_two_id
              : conversation.user_one_id;

          /*
          |------------------------------------------------------------------
          | NOTIFY OTHER USER
          |------------------------------------------------------------------
          */

          io.to(
            `user:${otherUserId}`
          ).emit(
            "conversation_updated",
            {
              conversation_id:
                conversationId,

              message:
                savedMessage,
            }
          );

          /*
          |------------------------------------------------------------------
          | CALLBACK
          |------------------------------------------------------------------
          */

          if (
            typeof callback ===
            "function"
          ) {
            callback({
              ok: true,

              message:
                savedMessage,
            });
          }

          console.log(
            `Message sent: type=${messageType}, conversation=${conversationId}, user=${user.id}`
          );
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
                "Unable to send message",
            });
          }
        }
      }
    );

    /*
    |----------------------------------------------------------------------
    | TYPING
    |----------------------------------------------------------------------
    */

    socket.on(
      "typing",
      async (
        conversationId
      ) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(
              id
            ) ||
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
                user.id,
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
                  user.full_name,
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
    |----------------------------------------------------------------------
    | STOP TYPING
    |----------------------------------------------------------------------
    */

    socket.on(
      "stop_typing",
      async (
        conversationId
      ) => {
        try {
          const id =
            Number(
              conversationId
            );

          if (
            !Number.isInteger(
              id
            ) ||
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
                user.id,
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
                  user.id,
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
    |----------------------------------------------------------------------
    | DISCONNECT
    |----------------------------------------------------------------------
    */

    socket.on(
      "disconnect",
      async (
        reason
      ) => {
        console.log(
          `Socket disconnected: ${user.full_name} (${user.id}) - ${reason}`
        );

        /*
        |------------------------------------------------------------------
        | Give another socket connection time to register.
        |------------------------------------------------------------------
        */

        setTimeout(
          async () => {
            try {
              const room =
                io.sockets.adapter.rooms.get(
                  `user:${user.id}`
                );

              const remainingConnections =
                room
                  ? room.size
                  : 0;

              /*
              |----------------------------------------------------------------
              | If user has no other active connections,
              | mark them offline.
              |----------------------------------------------------------------
              */

              if (
                remainingConnections ===
                0
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

                io.emit(
                  "user_status_changed",
                  {
                    user_id:
                      user.id,

                    is_online:
                      false,

                    last_seen:
                      new Date(),
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
          },
          100
        );
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
    return res.status(404).json({
      ok: false,

      message:
        "API route not found",

      path:
        req.originalUrl,
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

    return res.status(500).json({
      ok: false,

      message:
        "Internal server error",
    });
  }
);

/*
|--------------------------------------------------------------------------
| HTTP SERVER ERROR
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
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

const shutdown = async (
  signal
) => {
  console.log(
    `\n${signal} received. Shutting down UC Chat server...`
  );

  try {
    await closeDatabase();

    httpServer.close(
      () => {
        console.log(
          "HTTP server closed."
        );

        process.exit(0);
      }
    );
  } catch (error) {
    console.error(
      "Shutdown error:",
      error
    );

    process.exit(1);
  }
};

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

const startServer =
  async () => {
    try {
      /*
      |----------------------------------------------------------------------
      | Test database before accepting requests
      |----------------------------------------------------------------------
      */

      const databaseConnected =
        await testDatabaseConnection();

      if (!databaseConnected) {
        console.error("");
        console.error(
          "WARNING: UC Chat server is starting, but the database is not connected."
        );
        console.error(
          "Please check your server/.env database settings."
        );
        console.error("");
      }

      /*
      |----------------------------------------------------------------------
      | START HTTP + SOCKET SERVER
      |----------------------------------------------------------------------
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
            `Uploads:   ${SERVER_URL}/uploads/`
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
            "Text messages:  ENABLED"
          );

          console.log(
            "Image messages: ENABLED"
          );

          console.log(
            "File messages:  ENABLED"
          );

          console.log(
            "File uploads:   ENABLED"
          );

          console.log(
            "Max file size:  15MB"
          );

          console.log(
            "========================================"
          );

          console.log("");
        }
      );
    } catch (error) {
      console.error(
        "Failed to start UC Chat server:",
        error
      );

      process.exit(1);
    }
  };

startServer();