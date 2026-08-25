import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| SEND MESSAGE
| POST /api/messages
|--------------------------------------------------------------------------
*/

router.post("/", authenticate, async (req, res) => {
  try {
    const senderId = req.user.id;

    const {
      conversation_id,
      message,
      message_type = "text",
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

    if (!conversation_id) {
      return res.status(400).json({
        ok: false,
        message: "Conversation ID is required",
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        ok: false,
        message: "Message cannot be empty",
      });
    }

    const conversationId = Number(conversation_id);

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid conversation ID",
      });
    }

    const allowedTypes = [
      "text",
      "image",
      "file",
    ];

    if (!allowedTypes.includes(message_type)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid message type",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Check conversation
    |--------------------------------------------------------------------------
    */

    const [conversations] = await pool.query(
      `
      SELECT
        id,
        user_one_id,
        user_two_id
      FROM conversations
      WHERE id = ?
      LIMIT 1
      `,
      [conversationId]
    );

    if (conversations.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Conversation not found",
      });
    }

    const conversation = conversations[0];

    /*
    |--------------------------------------------------------------------------
    | Check whether current user belongs to conversation
    |--------------------------------------------------------------------------
    */

    if (
      conversation.user_one_id !== senderId &&
      conversation.user_two_id !== senderId
    ) {
      return res.status(403).json({
        ok: false,
        message: "You are not a member of this conversation",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Insert message
    |--------------------------------------------------------------------------
    */

    const cleanMessage = String(message).trim();

    const [result] = await pool.query(
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
        senderId,
        cleanMessage,
        message_type,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | Return newly created message
    |--------------------------------------------------------------------------
    */

    const [messages] = await pool.query(
      `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.message,
        m.message_type,
        m.is_read,
        m.created_at,
        u.full_name AS sender_name,
        u.email AS sender_email,
        u.profile_picture AS sender_picture
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
      message: "Message sent successfully",
      data: messages[0],
    });
  } catch (error) {
    console.error(
      "Send message error:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Unable to send message",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET MESSAGES
| GET /api/messages/:conversationId
|--------------------------------------------------------------------------
*/

router.get(
  "/:conversationId",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const conversationId = Number(
        req.params.conversationId
      );

      if (!Number.isInteger(conversationId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid conversation ID",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Check conversation access
      |--------------------------------------------------------------------------
      */

      const [conversations] = await pool.query(
        `
        SELECT
          id,
          user_one_id,
          user_two_id
        FROM conversations
        WHERE id = ?
        LIMIT 1
        `,
        [conversationId]
      );

      if (conversations.length === 0) {
        return res.status(404).json({
          ok: false,
          message: "Conversation not found",
        });
      }

      const conversation = conversations[0];

      if (
        conversation.user_one_id !== userId &&
        conversation.user_two_id !== userId
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Load messages
      |--------------------------------------------------------------------------
      */

      const [messages] = await pool.query(
        `
        SELECT
          m.id,
          m.conversation_id,
          m.sender_id,
          m.message,
          m.message_type,
          m.is_read,
          m.created_at,

          u.full_name AS sender_name,
          u.email AS sender_email,
          u.profile_picture AS sender_picture

        FROM messages m

        JOIN users u
          ON u.id = m.sender_id

        WHERE m.conversation_id = ?

        ORDER BY m.created_at ASC
        `,
        [conversationId]
      );

      /*
      |--------------------------------------------------------------------------
      | Mark received messages as read
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE messages
        SET is_read = TRUE
        WHERE conversation_id = ?
        AND sender_id != ?
        AND is_read = FALSE
        `,
        [
          conversationId,
          userId,
        ]
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
        message: "Unable to load messages",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MARK MESSAGE AS READ
| PUT /api/messages/:id/read
|--------------------------------------------------------------------------
*/

router.put(
  "/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const messageId = Number(
        req.params.id
      );

      if (!Number.isInteger(messageId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid message ID",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Find message and conversation
      |--------------------------------------------------------------------------
      */

      const [messages] = await pool.query(
        `
        SELECT
          m.id,
          m.sender_id,
          m.conversation_id,
          c.user_one_id,
          c.user_two_id

        FROM messages m

        JOIN conversations c
          ON c.id = m.conversation_id

        WHERE m.id = ?

        LIMIT 1
        `,
        [messageId]
      );

      if (messages.length === 0) {
        return res.status(404).json({
          ok: false,
          message: "Message not found",
        });
      }

      const message = messages[0];

      /*
      |--------------------------------------------------------------------------
      | Check conversation access
      |--------------------------------------------------------------------------
      */

      if (
        message.user_one_id !== userId &&
        message.user_two_id !== userId
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "You cannot access this message",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Only receiver can mark it as read
      |--------------------------------------------------------------------------
      */

      if (message.sender_id === userId) {
        return res.json({
          ok: true,
          message:
            "Your own message does not need to be marked as read",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Update
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE messages
        SET is_read = TRUE
        WHERE id = ?
        `,
        [messageId]
      );

      res.json({
        ok: true,
        message: "Message marked as read",
      });
    } catch (error) {
      console.error(
        "Mark message read error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to mark message as read",
      });
    }
  }
);

export default router;