import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| HELPER: FORMAT MESSAGE
|--------------------------------------------------------------------------
*/

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

    sender_id: Number(
      message.sender_id
    ),

    is_read:
      Number(message.is_read) === 1
        ? 1
        : 0,
  };
};

/*
|--------------------------------------------------------------------------
| HELPER: CHECK CONVERSATION ACCESS
|--------------------------------------------------------------------------
*/

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

    WHERE id = ?

    LIMIT 1
    `,
    [conversationId]
  );

  if (rows.length === 0) {
    return {
      exists: false,
      allowed: false,
      conversation: null,
    };
  }

  const conversation = rows[0];

  const allowed =
    Number(conversation.user_one_id) ===
      Number(userId) ||
    Number(conversation.user_two_id) ===
      Number(userId);

  return {
    exists: true,
    allowed,
    conversation,
  };
};

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
      const userId = Number(
        req.user.id
      );

      const conversationId = Number(
        req.params.conversationId
      );

      /*
      |--------------------------------------------------------------------------
      | VALIDATE USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE CONVERSATION
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | CHECK ACCESS
      |--------------------------------------------------------------------------
      */

      const access =
        await checkConversationAccess(
          conversationId,
          userId
        );

      if (!access.exists) {
        return res.status(404).json({
          ok: false,
          message:
            "Conversation not found",
        });
      }

      if (!access.allowed) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | LOAD MESSAGES
      |--------------------------------------------------------------------------
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

            u.full_name AS sender_name,
            u.email AS sender_email,
            u.profile_picture AS sender_picture

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

      /*
      |--------------------------------------------------------------------------
      | MARK RECEIVED MESSAGES AS READ
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,

        messages:
          messages.map(
            formatMessage
          ),
      });
    } catch (error) {
      console.error(
        "Get messages error:",
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

/*
|--------------------------------------------------------------------------
| SEND TEXT MESSAGE
| POST /api/messages
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  authenticate,
  async (req, res) => {
    try {
      const senderId = Number(
        req.user.id
      );

      const {
        conversation_id,
        message,
        message_type = "text",
      } = req.body || {};

      /*
      |--------------------------------------------------------------------------
      | VALIDATE USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(senderId) ||
        senderId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CONVERSATION ID
      |--------------------------------------------------------------------------
      */

      const conversationId = Number(
        conversation_id
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
            "Valid conversation ID is required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | MESSAGE TYPE
      |--------------------------------------------------------------------------
      */

      const cleanMessageType =
        String(
          message_type || "text"
        )
          .trim()
          .toLowerCase();

      if (
        cleanMessageType !== "text"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Only text messages are supported by this endpoint",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | MESSAGE
      |--------------------------------------------------------------------------
      */

      const cleanMessage = String(
        message || ""
      ).trim();

      if (!cleanMessage) {
        return res.status(400).json({
          ok: false,
          message:
            "Message cannot be empty",
        });
      }

      if (
        cleanMessage.length > 5000
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Message cannot be longer than 5000 characters",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK CONVERSATION ACCESS
      |--------------------------------------------------------------------------
      */

      const access =
        await checkConversationAccess(
          conversationId,
          senderId
        );

      if (!access.exists) {
        return res.status(404).json({
          ok: false,
          message:
            "Conversation not found",
        });
      }

      if (!access.allowed) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | INSERT MESSAGE
      |--------------------------------------------------------------------------
      */

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
            senderId,
            cleanMessage,
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | UPDATE CONVERSATION
      |--------------------------------------------------------------------------
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
      |--------------------------------------------------------------------------
      | LOAD CREATED MESSAGE
      |--------------------------------------------------------------------------
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

            u.full_name AS sender_name,
            u.email AS sender_email,
            u.profile_picture AS sender_picture

          FROM messages m

          INNER JOIN users u
            ON u.id = m.sender_id

          WHERE
            m.id = ?

          LIMIT 1
          `,
          [result.insertId]
        );

      if (messages.length === 0) {
        return res.status(500).json({
          ok: false,
          message:
            "Message was created but could not be loaded",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.status(201).json({
        ok: true,

        message:
          "Message sent successfully",

        data:
          formatMessage(
            messages[0]
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

/*
|--------------------------------------------------------------------------
| MARK SINGLE MESSAGE AS READ
| PUT /api/messages/:id/read
|--------------------------------------------------------------------------
*/

router.put(
  "/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(
        req.user.id
      );

      const messageId = Number(
        req.params.id
      );

      /*
      |--------------------------------------------------------------------------
      | VALIDATE USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE MESSAGE ID
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | FIND MESSAGE
      |--------------------------------------------------------------------------
      */

      const [messages] =
        await pool.query(
          `
          SELECT
            m.id,
            m.sender_id,
            m.conversation_id,
            m.is_read,

            c.user_one_id,
            c.user_two_id

          FROM messages m

          INNER JOIN conversations c
            ON c.id =
              m.conversation_id

          WHERE
            m.id = ?

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

      /*
      |--------------------------------------------------------------------------
      | CHECK CONVERSATION ACCESS
      |--------------------------------------------------------------------------
      */

      const isMember =
        Number(
          message.user_one_id
        ) === userId ||
        Number(
          message.user_two_id
        ) === userId;

      if (!isMember) {
        return res.status(403).json({
          ok: false,
          message:
            "You cannot access this message",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | OWN MESSAGE
      |--------------------------------------------------------------------------
      */

      if (
        Number(
          message.sender_id
        ) === userId
      ) {
        return res.json({
          ok: true,
          message:
            "Your own message does not need to be marked as read",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | ALREADY READ
      |--------------------------------------------------------------------------
      */

      if (
        Number(
          message.is_read
        ) === 1
      ) {
        return res.json({
          ok: true,
          message:
            "Message is already marked as read",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | MARK AS READ
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE messages

        SET
          is_read = TRUE

        WHERE
          id = ?
        `,
        [messageId]
      );

      return res.json({
        ok: true,
        message:
          "Message marked as read",
      });
    } catch (error) {
      console.error(
        "Mark message read error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to mark message as read",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MARK ALL MESSAGES IN CONVERSATION AS READ
| POST /api/messages/:conversationId/read
|--------------------------------------------------------------------------
*/

router.post(
  "/:conversationId/read",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(
        req.user.id
      );

      const conversationId =
        Number(
          req.params.conversationId
        );

      /*
      |--------------------------------------------------------------------------
      | VALIDATE USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE CONVERSATION
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | CHECK ACCESS
      |--------------------------------------------------------------------------
      */

      const access =
        await checkConversationAccess(
          conversationId,
          userId
        );

      if (!access.exists) {
        return res.status(404).json({
          ok: false,
          message:
            "Conversation not found",
        });
      }

      if (!access.allowed) {
        return res.status(403).json({
          ok: false,
          message:
            "You are not a member of this conversation",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | MARK RECEIVED MESSAGES AS READ
      |--------------------------------------------------------------------------
      */

      const [result] =
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

        updated:
          Number(
            result.affectedRows
          ),
      });
    } catch (error) {
      console.error(
        "Mark conversation messages read error:",
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

/*
|--------------------------------------------------------------------------
| DELETE MESSAGE
| DELETE /api/messages/:id
|--------------------------------------------------------------------------
*/

router.delete(
  "/:id",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(
        req.user.id
      );

      const messageId = Number(
        req.params.id
      );

      /*
      |--------------------------------------------------------------------------
      | VALIDATE USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE MESSAGE ID
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | FIND MESSAGE
      |--------------------------------------------------------------------------
      */

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

          WHERE
            id = ?

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

      /*
      |--------------------------------------------------------------------------
      | CHECK OWNER
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | DELETE MESSAGE
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        DELETE FROM messages

        WHERE
          id = ?
        `,
        [messageId]
      );

      /*
      |--------------------------------------------------------------------------
      | UPDATE CONVERSATION
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE conversations

        SET
          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          id = ?
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

/*
|--------------------------------------------------------------------------
| ROUTER ERROR HANDLER
|--------------------------------------------------------------------------
*/

router.use(
  (error, req, res, next) => {
    console.error(
      "Messages router error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      ok: false,
      message:
        "An unexpected message server error occurred",
    });
  }
);

export default router;