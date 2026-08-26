import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| HELPER: FORMAT USER
|--------------------------------------------------------------------------
*/

const formatUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    profile_picture: user.profile_picture || null,
    is_online: Number(user.is_online) === 1,
    last_seen: user.last_seen || null,
    created_at: user.created_at || null,
  };
};

/*
|--------------------------------------------------------------------------
| HELPER: FORMAT CONVERSATION
|--------------------------------------------------------------------------
*/

const formatConversation = (conversation) => {
  if (!conversation) {
    return null;
  }

  return {
    ...conversation,

    is_online:
      Number(conversation.is_online) === 1,

    other_user_online:
      Number(conversation.other_user_online) === 1,

    unread_count:
      Number(conversation.unread_count || 0),

    other_user: conversation.other_user
      ? {
          ...conversation.other_user,

          is_online:
            Number(
              conversation.other_user.is_online
            ) === 1,
        }
      : null,
  };
};

/*
|--------------------------------------------------------------------------
| GET USER CONVERSATIONS
| GET /api/conversations
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  authenticate,
  async (req, res) => {
    try {
      const userId = Number(req.user.id);

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message: "Invalid authenticated user",
        });
      }

      const [conversations] =
        await pool.query(
          `
          SELECT
            c.id,
            c.user_one_id,
            c.user_two_id,
            c.created_at,
            c.updated_at,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.id
              ELSE u1.id
            END AS other_user_id,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.full_name
              ELSE u1.full_name
            END AS other_user_name,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.email
              ELSE u1.email
            END AS other_user_email,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.profile_picture
              ELSE u1.profile_picture
            END AS other_user_picture,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.is_online
              ELSE u1.is_online
            END AS other_user_online,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.last_seen
              ELSE u1.last_seen
            END AS other_user_last_seen,

            (
              SELECT m.message
              FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message,

            (
              SELECT m.message_type
              FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message_type,

            (
              SELECT m.created_at
              FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message_at,

            (
              SELECT COUNT(*)
              FROM messages m
              WHERE
                m.conversation_id = c.id
                AND m.sender_id != ?
                AND m.is_read = FALSE
            ) AS unread_count

          FROM conversations c

          INNER JOIN users u1
            ON u1.id = c.user_one_id

          INNER JOIN users u2
            ON u2.id = c.user_two_id

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
            userId,
            userId,
            userId,
            userId,
            userId,
          ]
        );

      const formattedConversations =
        conversations.map(
          (conversation) => {
            return formatConversation({
              ...conversation,

              other_user: {
                id:
                  conversation.other_user_id,

                full_name:
                  conversation.other_user_name,

                email:
                  conversation.other_user_email,

                profile_picture:
                  conversation.other_user_picture ||
                  null,

                is_online:
                  Number(
                    conversation.other_user_online
                  ) === 1,

                last_seen:
                  conversation.other_user_last_seen ||
                  null,
              },
            });
          }
        );

      return res.json({
        ok: true,
        conversations:
          formattedConversations,
      });
    } catch (error) {
      console.error(
        "Get conversations error:",
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

/*
|--------------------------------------------------------------------------
| CREATE OR GET CONVERSATION
| POST /api/conversations
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  authenticate,
  async (req, res) => {
    try {
      const currentUserId =
        Number(req.user.id);

      const otherUserId =
        Number(req.body?.user_id);

      /*
      |--------------------------------------------------------------------------
      | VALIDATE CURRENT USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(
          currentUserId
        ) ||
        currentUserId <= 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid authenticated user",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE TARGET USER
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(
          otherUserId
        ) ||
        otherUserId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid user ID",
        });
      }

      if (
        currentUserId ===
        otherUserId
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "You cannot create a conversation with yourself",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK TARGET USER
      |--------------------------------------------------------------------------
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
            last_seen,
            created_at

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [otherUserId]
        );

      if (users.length === 0) {
        return res.status(404).json({
          ok: false,
          message:
            "User not found",
        });
      }

      const otherUser =
        formatUser(users[0]);

      /*
      |--------------------------------------------------------------------------
      | KEEP USER ORDER CONSISTENT
      |--------------------------------------------------------------------------
      */

      const userOneId =
        Math.min(
          currentUserId,
          otherUserId
        );

      const userTwoId =
        Math.max(
          currentUserId,
          otherUserId
        );

      /*
      |--------------------------------------------------------------------------
      | CHECK EXISTING CONVERSATION
      |--------------------------------------------------------------------------
      */

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
          message:
            "Conversation already exists",

          conversation:
            existing[0],

          other_user:
            otherUser,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CREATE CONVERSATION
      |--------------------------------------------------------------------------
      */

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

      /*
      |--------------------------------------------------------------------------
      | LOAD CREATED CONVERSATION
      |--------------------------------------------------------------------------
      */

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
        message:
          "Conversation created successfully",

        conversation:
          created[0] || {
            id: result.insertId,
            user_one_id:
              userOneId,
            user_two_id:
              userTwoId,
          },

        other_user:
          otherUser,
      });
    } catch (error) {
      console.error(
        "Create conversation error:",
        error
      );

      /*
      |--------------------------------------------------------------------------
      | HANDLE DUPLICATE CONVERSATION
      |--------------------------------------------------------------------------
      */

      if (
        error.code ===
        "ER_DUP_ENTRY"
      ) {
        try {
          const currentUserId =
            Number(req.user.id);

          const otherUserId =
            Number(
              req.body?.user_id
            );

          const userOneId =
            Math.min(
              currentUserId,
              otherUserId
            );

          const userTwoId =
            Math.max(
              currentUserId,
              otherUserId
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
                [otherUserId]
              );

            return res.json({
              ok: true,

              message:
                "Conversation already exists",

              conversation:
                rows[0],

              other_user:
                users.length > 0
                  ? formatUser(
                      users[0]
                    )
                  : null,
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

/*
|--------------------------------------------------------------------------
| GET SINGLE CONVERSATION
| GET /api/conversations/:id
|--------------------------------------------------------------------------
*/

router.get(
  "/:id",
  authenticate,
  async (req, res) => {
    try {
      const conversationId =
        Number(req.params.id);

      const userId =
        Number(req.user.id);

      /*
      |--------------------------------------------------------------------------
      | VALIDATE IDs
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
      | LOAD CONVERSATION
      |--------------------------------------------------------------------------
      */

      const [conversations] =
        await pool.query(
          `
          SELECT
            c.id,
            c.user_one_id,
            c.user_two_id,
            c.created_at,
            c.updated_at,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.id
              ELSE u1.id
            END AS other_user_id,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.full_name
              ELSE u1.full_name
            END AS other_user_name,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.email
              ELSE u1.email
            END AS other_user_email,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.profile_picture
              ELSE u1.profile_picture
            END AS other_user_picture,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.is_online
              ELSE u1.is_online
            END AS other_user_online,

            CASE
              WHEN c.user_one_id = ?
              THEN u2.last_seen
              ELSE u1.last_seen
            END AS other_user_last_seen,

            (
              SELECT m.message
              FROM messages m
              WHERE
                m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message,

            (
              SELECT m.message_type
              FROM messages m
              WHERE
                m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message_type,

            (
              SELECT m.created_at
              FROM messages m
              WHERE
                m.conversation_id = c.id
              ORDER BY m.id DESC
              LIMIT 1
            ) AS last_message_at,

            (
              SELECT COUNT(*)
              FROM messages m
              WHERE
                m.conversation_id = c.id
                AND m.sender_id != ?
                AND m.is_read = FALSE
            ) AS unread_count

          FROM conversations c

          INNER JOIN users u1
            ON u1.id =
              c.user_one_id

          INNER JOIN users u2
            ON u2.id =
              c.user_two_id

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
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            conversationId,
            userId,
            userId,
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | CONVERSATION NOT FOUND
      |--------------------------------------------------------------------------
      */

      if (
        conversations.length === 0
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Conversation not found",
        });
      }

      const conversation =
        conversations[0];

      /*
      |--------------------------------------------------------------------------
      | FORMAT OTHER USER
      |--------------------------------------------------------------------------
      */

      const otherUser = {
        id:
          conversation.other_user_id,

        full_name:
          conversation.other_user_name,

        email:
          conversation.other_user_email,

        profile_picture:
          conversation.other_user_picture ||
          null,

        is_online:
          Number(
            conversation.other_user_online
          ) === 1,

        last_seen:
          conversation.other_user_last_seen ||
          null,
      };

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,

        conversation: {
          ...conversation,

          other_user_online:
            Number(
              conversation.other_user_online
            ) === 1,

          unread_count:
            Number(
              conversation.unread_count ||
                0
            ),

          other_user:
            otherUser,
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

/*
|--------------------------------------------------------------------------
| EXPORT ROUTER
|--------------------------------------------------------------------------
*/

export default router;