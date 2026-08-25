import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| CREATE / GET CONVERSATION
| POST /api/chat/conversations
|--------------------------------------------------------------------------
*/

router.post(
  "/conversations",
  authenticate,
  async (req, res) => {
    try {
      const currentUserId = req.user.id;
      const otherUserId = Number(req.body.user_id);

      if (!otherUserId) {
        return res.status(400).json({
          ok: false,
          message: "User ID is required",
        });
      }

      if (currentUserId === otherUserId) {
        return res.status(400).json({
          ok: false,
          message: "You cannot chat with yourself",
        });
      }

      const [users] = await pool.query(
        `
        SELECT
          id,
          full_name,
          email,
          profile_picture,
          last_seen
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [otherUserId]
      );

      if (users.length === 0) {
        return res.status(404).json({
          ok: false,
          message: "User not found",
        });
      }

      const userOneId = Math.min(
        currentUserId,
        otherUserId
      );

      const userTwoId = Math.max(
        currentUserId,
        otherUserId
      );

      const [existing] = await pool.query(
        `
        SELECT id
        FROM conversations
        WHERE user_one_id = ?
        AND user_two_id = ?
        LIMIT 1
        `,
        [
          userOneId,
          userTwoId,
        ]
      );

      let conversationId;

      if (existing.length > 0) {
        conversationId = existing[0].id;
      } else {
        const [result] = await pool.query(
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

        conversationId = result.insertId;
      }

      res.json({
        ok: true,

        conversation: {
          id: conversationId,

          user: users[0],
        },
      });
    } catch (error) {
      console.error(
        "Create conversation error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to create conversation",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET MY CONVERSATIONS
| GET /api/chat/conversations
|--------------------------------------------------------------------------
*/

router.get(
  "/conversations",
  authenticate,
  async (req, res) => {
    try {
      const currentUserId =
        req.user.id;

      const [conversations] =
        await pool.query(
          `
          SELECT
            c.id,
            c.created_at,
            c.updated_at,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.id
              ELSE u1.id
            END AS user_id,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.full_name
              ELSE u1.full_name
            END AS full_name,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.email
              ELSE u1.email
            END AS email,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.profile_picture
              ELSE u1.profile_picture
            END AS profile_picture,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.last_seen
              ELSE u1.last_seen
            END AS last_seen

          FROM conversations c

          JOIN users u1
            ON u1.id = c.user_one_id

          JOIN users u2
            ON u2.id = c.user_two_id

          WHERE
            c.user_one_id = ?
            OR c.user_two_id = ?

          ORDER BY
            c.updated_at DESC
          `,
          [
            currentUserId,
            currentUserId,
            currentUserId,
            currentUserId,
            currentUserId,
            currentUserId,
            currentUserId,
          ]
        );

      res.json({
        ok: true,
        conversations,
      });
    } catch (error) {
      console.error(
        "Get conversations error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load conversations",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET MESSAGES
| GET /api/chat/conversations/:id/messages
|--------------------------------------------------------------------------
*/

router.get(
  "/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const currentUserId =
        req.user.id;

      if (!conversationId) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid conversation ID",
        });
      }

      const [conversation] =
        await pool.query(
          `
          SELECT id
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
            currentUserId,
            currentUserId,
          ]
        );

      if (conversation.length === 0) {
        return res.status(403).json({
          ok: false,
          message:
            "You do not have access to this conversation",
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
            u.full_name AS sender_name

          FROM messages m

          JOIN users u
            ON u.id = m.sender_id

          WHERE
            m.conversation_id = ?

          ORDER BY
            m.created_at ASC
          `,
          [conversationId]
        );

      res.json({
        ok: true,
        messages,
      });
    } catch (error) {
      console.error(
        "Get messages error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load messages",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| SEND MESSAGE
| POST /api/chat/conversations/:id/messages
|--------------------------------------------------------------------------
*/

router.post(
  "/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const currentUserId =
        req.user.id;

      const message =
        String(
          req.body.message || ""
        ).trim();

      const messageType =
        req.body.message_type ||
        "text";

      if (!conversationId) {
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
        return res.status(400).json({
          ok: false,
          message:
            "Invalid message type",
        });
      }

      const [conversation] =
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
            currentUserId,
            currentUserId,
          ]
        );

      if (conversation.length === 0) {
        return res.status(403).json({
          ok: false,
          message:
            "You do not have access to this conversation",
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
            message_type
          )
          VALUES (?, ?, ?, ?)
          `,
          [
            conversationId,
            currentUserId,
            message,
            messageType,
          ]
        );

      await pool.query(
        `
        UPDATE conversations
        SET updated_at =
          CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [conversationId]
      );

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
            u.full_name AS sender_name

          FROM messages m

          JOIN users u
            ON u.id = m.sender_id

          WHERE m.id = ?

          LIMIT 1
          `,
          [result.insertId]
        );

      res.status(201).json({
        ok: true,
        message: messages[0],
      });
    } catch (error) {
      console.error(
        "Send message error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to send message",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| MARK MESSAGES AS READ
| POST /api/chat/conversations/:id/read
|--------------------------------------------------------------------------
*/

router.post(
  "/conversations/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const currentUserId =
        req.user.id;

      const [conversation] =
        await pool.query(
          `
          SELECT id
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
            currentUserId,
            currentUserId,
          ]
        );

      if (conversation.length === 0) {
        return res.status(403).json({
          ok: false,
          message:
            "You do not have access to this conversation",
        });
      }

      await pool.query(
        `
        UPDATE messages
        SET is_read = TRUE

        WHERE conversation_id = ?

        AND sender_id != ?
        `,
        [
          conversationId,
          currentUserId,
        ]
      );

      res.json({
        ok: true,
        message:
          "Messages marked as read",
      });
    } catch (error) {
      console.error(
        "Mark read error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to mark messages as read",
      });
    }
  }
);


export default router;