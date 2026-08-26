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
    id: Number(user.id),
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
| HELPER: GET AUTHENTICATED USER ID
|--------------------------------------------------------------------------
*/
const getAuthenticatedUserId = (req) => {
  const userId = Number(req.user?.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  return userId;
};

/*
|--------------------------------------------------------------------------
| SEARCH USERS
| GET /api/users/search?q=ujjal
|--------------------------------------------------------------------------
*/
router.get("/search", authenticate, async (req, res) => {
  try {
    const currentUserId = getAuthenticatedUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authenticated user",
      });
    }

    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.json({
        ok: true,
        users: [],
      });
    }

    if (query.length > 100) {
      return res.status(400).json({
        ok: false,
        message: "Search query is too long",
      });
    }

    const searchTerm = `%${query}%`;

    const [rows] = await pool.query(
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

      WHERE
        id != ?

        AND (
          full_name LIKE ?
          OR email LIKE ?
        )

      ORDER BY
        is_online DESC,
        full_name ASC

      LIMIT 20
      `,
      [
        currentUserId,
        searchTerm,
        searchTerm,
      ]
    );

    return res.json({
      ok: true,
      users: rows.map(formatUser),
    });
  } catch (error) {
    console.error("User search error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to search users",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CURRENT USER
| GET /api/users/me
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This MUST come before /:id.
|--------------------------------------------------------------------------
*/
router.get("/me", authenticate, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authenticated user",
      });
    }

    const [rows] = await pool.query(
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
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      user: formatUser(rows[0]),
    });
  } catch (error) {
    console.error("Current user error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load current user",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET ALL USERS
| GET /api/users
|--------------------------------------------------------------------------
*/
router.get("/", authenticate, async (req, res) => {
  try {
    const currentUserId = getAuthenticatedUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authenticated user",
      });
    }

    const [rows] = await pool.query(
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

      WHERE id != ?

      ORDER BY
        is_online DESC,
        full_name ASC

      LIMIT 50
      `,
      [currentUserId]
    );

    return res.json({
      ok: true,
      users: rows.map(formatUser),
    });
  } catch (error) {
    console.error("Users error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load users",
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE ONLINE STATUS
| POST /api/users/status
|--------------------------------------------------------------------------
|
| Body:
| {
|   "is_online": true
| }
|--------------------------------------------------------------------------
*/
router.post("/status", authenticate, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authenticated user",
      });
    }

    const value = req.body?.is_online;

    const isOnline =
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true";

    await pool.query(
      `
      UPDATE users

      SET
        is_online = ?,
        last_seen = CURRENT_TIMESTAMP

      WHERE id = ?
      `,
      [
        isOnline ? 1 : 0,
        userId,
      ]
    );

    return res.json({
      ok: true,
      is_online: isOnline,
      last_seen: new Date(),
    });
  } catch (error) {
    console.error("Status update error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to update online status",
    });
  }
});

/*
|--------------------------------------------------------------------------
| HEARTBEAT
| POST /api/users/heartbeat
|--------------------------------------------------------------------------
|
| Keeps the user online while the application is open.
|--------------------------------------------------------------------------
*/
router.post(
  "/heartbeat",
  authenticate,
  async (req, res) => {
    try {
      const userId = getAuthenticatedUserId(req);

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Invalid authenticated user",
        });
      }

      await pool.query(
        `
        UPDATE users

        SET
          is_online = 1,
          last_seen = CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [userId]
      );

      return res.json({
        ok: true,
        is_online: true,
      });
    } catch (error) {
      console.error("Heartbeat error:", error);

      return res.status(500).json({
        ok: false,
        message: "Unable to update heartbeat",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET USER BY ID
| GET /api/users/:id
|--------------------------------------------------------------------------
|
| IMPORTANT:
| Keep this route AFTER:
|   /search
|   /me
|   /
|   /status
|   /heartbeat
|--------------------------------------------------------------------------
*/
router.get("/:id", authenticate, async (req, res) => {
  try {
    const currentUserId = getAuthenticatedUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid authenticated user",
      });
    }

    const userId = Number(req.params.id);

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      return res.status(400).json({
        ok: false,
        message: "Invalid user ID",
      });
    }

    const [rows] = await pool.query(
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
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      user: formatUser(rows[0]),
    });
  } catch (error) {
    console.error("Get user error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load user",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GLOBAL USERS ROUTER ERROR HANDLER
|--------------------------------------------------------------------------
*/
router.use(
  (error, req, res, next) => {
    console.error(
      "Users router error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      ok: false,
      message: "Users service error",
    });
  }
);

/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/
export default router;