import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/* =========================================================
   PATH CONFIGURATION
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, {
    recursive: true,
  });
}

/* =========================================================
   SERVER BASE URL
========================================================= */

const getServerBaseUrl = (req) => {
  const configuredUrl = process.env.SERVER_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  const protocol =
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    "http";

  const host =
    req.get("host") ||
    `localhost:${process.env.PORT || 5000}`;

  return `${protocol}://${host}`;
};

/* =========================================================
   MULTER STORAGE
========================================================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },

  filename: (req, file, cb) => {
    const extension = path
      .extname(file.originalname)
      .toLowerCase();

    const safeExtension =
      extension.length <= 10
        ? extension
        : "";

    const filename = `${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${safeExtension}`;

    cb(null, filename);
  },
});

/* =========================================================
   IMAGE UPLOAD
========================================================= */

const imageUpload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(
      new Error(
        "Only JPG, JPEG, PNG, GIF and WEBP images are allowed"
      )
    );
  },
});

/* =========================================================
   FORMAT MESSAGE
========================================================= */

const formatMessage = (message) => {
  if (!message) {
    return null;
  }

  return {
    ...message,

    id: Number(message.id),

    conversation_id: Number(
      message.conversation_id
    ),

    sender_id: Number(message.sender_id),

    is_read:
      Number(message.is_read) === 1 ? 1 : 0,
  };
};

/* =========================================================
   FORMAT USER
========================================================= */

const formatUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    ...user,

    id: Number(user.id),

    is_online:
      Number(user.is_online) === 1 ? 1 : 0,

    profile_picture:
      user.profile_picture || null,

    last_seen:
      user.last_seen || null,
  };
};

/* =========================================================
   CHECK CONVERSATION ACCESS
========================================================= */

const checkConversationAccess = async (
  conversationId,
  userId
) => {
  const [rows] = await pool.query(
    `
    SELECT
      id,
      user_one_id,
      user_two_id,
      created_at,
      updated_at

    FROM conversations

    WHERE
      id = ?

      AND (
        user_one_id = ?
        OR user_two_id = ?
      )

    LIMIT 1
    `,
    [
      conversationId,
      userId,
      userId,
    ]
  );

  return rows.length > 0
    ? rows[0]
    : null;
};

/* =========================================================
   GET CONVERSATIONS
   GET /api/chat/conversations
========================================================= */

router.get(
  "/conversations",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(req.user.id);

      const [rows] = await pool.query(
        `
        SELECT
          c.id,
          c.user_one_id,
          c.user_two_id,
          c.created_at,
          c.updated_at,

          u.id AS user_id,
          u.full_name,
          u.email,
          u.profile_picture,
          u.is_online,
          u.last_seen,

          (
            SELECT m.message
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message,

          (
            SELECT m.created_at
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message_at,

          (
            SELECT m.message_type
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message_type,

          (
            SELECT COUNT(*)
            FROM messages m
            WHERE
              m.conversation_id = c.id
              AND m.sender_id != ?
              AND m.is_read = FALSE
          ) AS unread_count

        FROM conversations c

        INNER JOIN users u
          ON u.id =
            CASE
              WHEN c.user_one_id = ?
              THEN c.user_two_id
              ELSE c.user_one_id
            END

        WHERE
          c.user_one_id = ?
          OR c.user_two_id = ?

        ORDER BY
          COALESCE(
            (
              SELECT m.created_at
              FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ),
            c.updated_at,
            c.created_at
          ) DESC
        `,
        [
          userId,
          userId,
          userId,
          userId,
        ]
      );

      return res.json({
        ok: true,

        conversations: rows.map(
          (conversation) => ({
            ...conversation,

            id: Number(conversation.id),

            user_one_id: Number(
              conversation.user_one_id
            ),

            user_two_id: Number(
              conversation.user_two_id
            ),

            user_id: Number(
              conversation.user_id
            ),

            is_online:
              Number(
                conversation.is_online
              ) === 1
                ? 1
                : 0,

            unread_count: Number(
              conversation.unread_count || 0
            ),
          })
        ),
      });
    } catch (error) {
      console.error(
        "Load conversations error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load conversations",
      });
    }
  }
);

/* =========================================================
   CREATE / GET CONVERSATION
   POST /api/chat/conversations
========================================================= */

router.post(
  "/conversations",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(
        req.user.id
      );

      const targetUserId = Number(
        req.body?.user_id
      );

      if (
        !Number.isInteger(
          targetUserId
        ) ||
        targetUserId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid user ID",
        });
      }

      if (
        targetUserId === userId
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "You cannot start a conversation with yourself",
        });
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
            last_seen,
            created_at

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [targetUserId]
        );

      if (users.length === 0) {
        return res.status(404).json({
          ok: false,
          message:
            "User not found",
        });
      }

      const userOneId = Math.min(
        userId,
        targetUserId
      );

      const userTwoId = Math.max(
        userId,
        targetUserId
      );

      const [existing] =
        await pool.query(
          `
          SELECT
            id,
            user_one_id,
            user_two_id,
            created_at,
            updated_at

          FROM conversations

          WHERE
            user_one_id = ?
            AND user_two_id = ?

          LIMIT 1
          `,
          [
            userOneId,
            userTwoId,
          ]
        );

      if (existing.length > 0) {
        return res.json({
          ok: true,

          conversation: {
            ...existing[0],

            id: Number(
              existing[0].id
            ),
          },

          user: formatUser(
            users[0]
          ),
        });
      }

      const [result] =
        await pool.query(
          `
          INSERT INTO conversations
          (
            user_one_id,
            user_two_id
          )

          VALUES (?, ?)
          `,
          [
            userOneId,
            userTwoId,
          ]
        );

      const [created] =
        await pool.query(
          `
          SELECT
            id,
            user_one_id,
            user_two_id,
            created_at,
            updated_at

          FROM conversations

          WHERE id = ?

          LIMIT 1
          `,
          [result.insertId]
        );

      return res.status(201).json({
        ok: true,

        conversation: {
          ...created[0],

          id: Number(
            created[0].id
          ),
        },

        user: formatUser(
          users[0]
        ),
      });
    } catch (error) {
      console.error(
        "Create conversation error:",
        error
      );

      if (
        error.code ===
        "ER_DUP_ENTRY"
      ) {
        try {
          const userId = Number(
            req.user.id
          );

          const targetUserId =
            Number(
              req.body?.user_id
            );

          const userOneId =
            Math.min(
              userId,
              targetUserId
            );

          const userTwoId =
            Math.max(
              userId,
              targetUserId
            );

          const [rows] =
            await pool.query(
              `
              SELECT
                id,
                user_one_id,
                user_two_id,
                created_at,
                updated_at

              FROM conversations

              WHERE
                user_one_id = ?
                AND user_two_id = ?

              LIMIT 1
              `,
              [
                userOneId,
                userTwoId,
              ]
            );

          if (rows.length > 0) {
            return res.json({
              ok: true,

              conversation:
                rows[0],
            });
          }
        } catch (
          duplicateError
        ) {
          console.error(
            "Duplicate conversation recovery error:",
            duplicateError
          );
        }
      }

      return res.status(500).json({
        ok: false,
        message:
          "Unable to create conversation",
      });
    }
  }
);

/* =========================================================
   GET SINGLE CONVERSATION
   GET /api/chat/conversations/:id
========================================================= */

router.get(
  "/conversations/:id",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const userId = Number(
        req.user.id
      );

      if (
        !Number.isInteger(
          conversationId
        ) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid conversation ID",
        });
      }

      const [rows] =
        await pool.query(
          `
          SELECT
            c.id,
            c.user_one_id,
            c.user_two_id,
            c.created_at,
            c.updated_at,

            u.id AS user_id,
            u.full_name,
            u.email,
            u.profile_picture,
            u.is_online,
            u.last_seen

          FROM conversations c

          INNER JOIN users u
            ON u.id =
              CASE
                WHEN c.user_one_id = ?
                THEN c.user_two_id
                ELSE c.user_one_id
              END

          WHERE
            c.id = ?

            AND (
              c.user_one_id = ?
              OR c.user_two_id = ?
            )

          LIMIT 1
          `,
          [
            userId,
            conversationId,
            userId,
            userId,
          ]
        );

      if (rows.length === 0) {
        return res.status(404).json({
          ok: false,
          message:
            "Conversation not found",
        });
      }

      return res.json({
        ok: true,

        conversation: {
          ...rows[0],

          id: Number(
            rows[0].id
          ),

          user_id: Number(
            rows[0].user_id
          ),

          is_online:
            Number(
              rows[0].is_online
            ) === 1
              ? 1
              : 0,
        },
      });
    } catch (error) {
      console.error(
        "Get conversation error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load conversation",
      });
    }
  }
);

/* =========================================================
   LOAD MESSAGES
   GET /api/chat/conversations/:id/messages
========================================================= */

router.get(
  "/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const userId = Number(
        req.user.id
      );

      if (
        !Number.isInteger(
          conversationId
        ) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid conversation ID",
        });
      }

      const conversation =
        await checkConversationAccess(
          conversationId,
          userId
        );

      if (!conversation) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

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

            u.full_name,
            u.email,
            u.profile_picture

          FROM messages m

          INNER JOIN users u
            ON u.id = m.sender_id

          WHERE
            m.conversation_id = ?

          ORDER BY
            m.created_at ASC,
            m.id ASC
          `,
          [conversationId]
        );

      return res.json({
        ok: true,

        messages:
          messages.map(
            (message) => {
              const formatted =
                formatMessage(
                  message
                );

              if (
                formatted.message_type ===
                  "image" &&
                formatted.message &&
                !formatted.message.startsWith(
                  "http"
                )
              ) {
                formatted.message =
                  `${getServerBaseUrl(
                    req
                  )}${formatted.message}`;
              }

              return formatted;
            }
          ),
      });
    } catch (error) {
      console.error(
        "Load messages error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load messages",
      });
    }
  }
);

/* =========================================================
   SEND TEXT MESSAGE
   POST /api/chat/conversations/:id/messages
========================================================= */

router.post(
  "/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const userId = Number(
        req.user.id
      );

      const message = String(
        req.body?.message || ""
      ).trim();

      if (
        !Number.isInteger(
          conversationId
        ) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid conversation ID",
        });
      }

      if (!message) {
        return res.status(400).json({
          ok: false,
          message:
            "Message cannot be empty",
        });
      }

      if (message.length > 5000) {
        return res.status(400).json({
          ok: false,
          message:
            "Message is too long",
        });
      }

      const conversation =
        await checkConversationAccess(
          conversationId,
          userId
        );

      if (!conversation) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      const [result] =
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

          VALUES
          (?, ?, ?, 'text', FALSE)
          `,
          [
            conversationId,
            userId,
            message,
          ]
        );

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

      const [rows] =
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

            u.full_name,
            u.email,
            u.profile_picture

          FROM messages m

          INNER JOIN users u
            ON u.id = m.sender_id

          WHERE
            m.id = ?

          LIMIT 1
          `,
          [result.insertId]
        );

      if (rows.length === 0) {
        return res.status(500).json({
          ok: false,
          message:
            "Message was created but could not be loaded",
        });
      }

      return res.status(201).json({
        ok: true,

        message:
          formatMessage(
            rows[0]
          ),
      });
    } catch (error) {
      console.error(
        "Send message error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to send message",
      });
    }
  }
);

/* =========================================================
   UPLOAD IMAGE
   POST /api/chat/conversations/:id/image
========================================================= */

router.post(
  "/conversations/:id/image",
  authenticate,
  (req, res) => {
    imageUpload.single("image")(
      req,
      res,
      async (uploadError) => {
        try {
          if (uploadError) {
            console.error(
              "Image upload error:",
              uploadError
            );

            return res.status(400).json({
              ok: false,
              message:
                uploadError.message ||
                "Unable to upload image",
            });
          }

          const conversationId =
            Number(req.params.id);

          const userId = Number(
            req.user.id
          );

          if (
            !Number.isInteger(
              conversationId
            ) ||
            conversationId <= 0
          ) {
            if (req.file?.path) {
              fs.unlink(
                req.file.path,
                () => {}
              );
            }

            return res.status(400).json({
              ok: false,
              message:
                "Invalid conversation ID",
            });
          }

          if (!req.file) {
            return res.status(400).json({
              ok: false,
              message:
                "Please select an image",
            });
          }

          const conversation =
            await checkConversationAccess(
              conversationId,
              userId
            );

          if (!conversation) {
            fs.unlink(
              req.file.path,
              () => {}
            );

            return res.status(403).json({
              ok: false,
              message:
                "You are not a member of this conversation",
            });
          }

          const imagePath =
            `/uploads/${req.file.filename}`;

          const [result] =
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

              VALUES
              (?, ?, ?, 'image', FALSE)
              `,
              [
                conversationId,
                userId,
                imagePath,
              ]
            );

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

          const [rows] =
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

                u.full_name,
                u.email,
                u.profile_picture

              FROM messages m

              INNER JOIN users u
                ON u.id = m.sender_id

              WHERE
                m.id = ?

              LIMIT 1
              `,
              [result.insertId]
            );

          if (rows.length === 0) {
            fs.unlink(
              req.file.path,
              () => {}
            );

            return res.status(500).json({
              ok: false,
              message:
                "Image uploaded but message could not be loaded",
            });
          }

          const formattedMessage =
            formatMessage(
              rows[0]
            );

          formattedMessage.message =
            `${getServerBaseUrl(
              req
            )}${imagePath}`;

          return res.status(201).json({
            ok: true,

            message:
              formattedMessage,
          });
        } catch (error) {
          console.error(
            "Save image message error:",
            error
          );

          if (req.file?.path) {
            fs.unlink(
              req.file.path,
              () => {}
            );
          }

          return res.status(500).json({
            ok: false,
            message:
              "Unable to send image",
          });
        }
      }
    );
  }
);

/* =========================================================
   MARK CONVERSATION AS READ
   POST /api/chat/conversations/:id/read
========================================================= */

router.post(
  "/conversations/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const userId = Number(
        req.user.id
      );

      if (
        !Number.isInteger(
          conversationId
        ) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid conversation ID",
        });
      }

      const conversation =
        await checkConversationAccess(
          conversationId,
          userId
        );

      if (!conversation) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      await pool.query(
        `
        UPDATE messages

        SET
          is_read = TRUE

        WHERE
          conversation_id = ?

          AND sender_id != ?

          AND is_read = FALSE
        `,
        [
          conversationId,
          userId,
        ]
      );

      return res.json({
        ok: true,
        message:
          "Messages marked as read",
      });
    } catch (error) {
      console.error(
        "Mark read error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to mark messages as read",
      });
    }
  }
);

/* =========================================================
   DELETE MESSAGE
   DELETE /api/chat/messages/:id
========================================================= */

router.delete(
  "/messages/:id",
  authenticate,
  async (req, res) => {
    try {
      const messageId =
        Number(req.params.id);

      const userId = Number(
        req.user.id
      );

      if (
        !Number.isInteger(
          messageId
        ) ||
        messageId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid message ID",
        });
      }

      const [messages] =
        await pool.query(
          `
          SELECT
            id,
            conversation_id,
            sender_id,
            message,
            message_type

          FROM messages

          WHERE id = ?

          LIMIT 1
          `,
          [messageId]
        );

      if (messages.length === 0) {
        return res.status(404).json({
          ok: false,
          message:
            "Message not found",
        });
      }

      const message =
        messages[0];

      if (
        Number(
          message.sender_id
        ) !== userId
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "You can only delete your own messages",
        });
      }

      if (
        message.message_type ===
          "image" &&
        message.message
      ) {
        const imageFilename =
          path.basename(
            message.message
          );

        const imagePath =
          path.join(
            uploadsDir,
            imageFilename
          );

        if (
          fs.existsSync(
            imagePath
          )
        ) {
          fs.unlink(
            imagePath,
            () => {}
          );
        }
      }

      await pool.query(
        `
        DELETE FROM messages

        WHERE id = ?
        `,
        [messageId]
      );

      await pool.query(
        `
        UPDATE conversations

        SET
          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [message.conversation_id]
      );

      return res.json({
        ok: true,
        message:
          "Message deleted successfully",
      });
    } catch (error) {
      console.error(
        "Delete message error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to delete message",
      });
    }
  }
);

/* =========================================================
   MULTER / ROUTER ERROR HANDLER
========================================================= */

router.use(
  (error, req, res, next) => {
    console.error(
      "Chat router error:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "File upload error",
      });
    }

    return res.status(500).json({
      ok: false,
      message:
        "An unexpected chat server error occurred",
    });
  }
);

/* =========================================================
   EXPORT
========================================================= */

export default router;