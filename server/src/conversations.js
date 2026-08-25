import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET USER CONVERSATIONS
| GET /api/conversations
|--------------------------------------------------------------------------
*/

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const [conversations] = await pool.query(
      `
      SELECT
        c.id,
        c.created_at,

        CASE
          WHEN c.user_one_id = ? THEN c.user_two_id
          ELSE c.user_one_id
        END AS other_user_id,

        CASE
          WHEN c.user_one_id = ? THEN u2.full_name
          ELSE u1.full_name
        END AS other_user_name,

        CASE
          WHEN c.user_one_id = ? THEN u2.email
          ELSE u1.email
        END AS other_user_email,

        CASE
          WHEN c.user_one_id = ? THEN u2.profile_picture
          ELSE u1.profile_picture
        END AS other_user_picture

      FROM conversations c

      JOIN users u1
        ON u1.id = c.user_one_id

      JOIN users u2
        ON u2.id = c.user_two_id

      WHERE
        c.user_one_id = ?
        OR c.user_two_id = ?

      ORDER BY c.created_at DESC
      `,
      [
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
      ]
    );

    res.json({
      ok: true,
      conversations,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    res.status(500).json({
      ok: false,
      message: "Unable to load conversations",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CREATE OR GET CONVERSATION
| POST /api/conversations
|--------------------------------------------------------------------------
*/

router.post("/", authenticate, async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        ok: false,
        message: "User ID is required",
      });
    }

    const otherUserId = Number(user_id);

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid user ID",
      });
    }

    if (otherUserId === currentUserId) {
      return res.status(400).json({
        ok: false,
        message: "You cannot create a conversation with yourself",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Check whether the other user exists
    |--------------------------------------------------------------------------
    */

    const [users] = await pool.query(
      `
      SELECT
        id,
        full_name,
        email,
        profile_picture,
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
        message: "User not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Keep user IDs in consistent order
    |--------------------------------------------------------------------------
    */

    const userOneId = Math.min(
      currentUserId,
      otherUserId
    );

    const userTwoId = Math.max(
      currentUserId,
      otherUserId
    );

    /*
    |--------------------------------------------------------------------------
    | Check existing conversation
    |--------------------------------------------------------------------------
    */

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

    if (existing.length > 0) {
      return res.json({
        ok: true,
        message: "Conversation already exists",
        conversation: {
          id: existing[0].id,
          other_user: users[0],
        },
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Create conversation
    |--------------------------------------------------------------------------
    */

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

    res.status(201).json({
      ok: true,
      message: "Conversation created",
      conversation: {
        id: result.insertId,
        other_user: users[0],
      },
    });
  } catch (error) {
    console.error(
      "Create conversation error:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Unable to create conversation",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET SINGLE CONVERSATION
| GET /api/conversations/:id
|--------------------------------------------------------------------------
*/

router.get("/:id", authenticate, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = req.user.id;

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid conversation ID",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Make sure user belongs to conversation
    |--------------------------------------------------------------------------
    */

    const [conversations] = await pool.query(
      `
      SELECT
        c.id,
        c.created_at,

        CASE
          WHEN c.user_one_id = ? THEN c.user_two_id
          ELSE c.user_one_id
        END AS other_user_id,

        CASE
          WHEN c.user_one_id = ? THEN u2.full_name
          ELSE u1.full_name
        END AS other_user_name,

        CASE
          WHEN c.user_one_id = ? THEN u2.email
          ELSE u1.email
        END AS other_user_email,

        CASE
          WHEN c.user_one_id = ? THEN u2.profile_picture
          ELSE u1.profile_picture
        END AS other_user_picture

      FROM conversations c

      JOIN users u1
        ON u1.id = c.user_one_id

      JOIN users u2
        ON u2.id = c.user_two_id

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
        conversationId,
        userId,
        userId,
      ]
    );

    if (conversations.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Conversation not found",
      });
    }

    res.json({
      ok: true,
      conversation: conversations[0],
    });
  } catch (error) {
    console.error(
      "Get conversation error:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Unable to load conversation",
    });
  }
});

export default router;