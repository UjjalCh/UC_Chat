import express from "express";
import pool from "./db.js";
import { authenticate } from "./auth.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| FORMAT USER
|--------------------------------------------------------------------------
|
| Converts MySQL TINYINT(1) into a proper JavaScript boolean.
|
*/

const formatUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    ...user,

    is_online:
      Number(user.is_online) === 1,
  };
};


/*
|--------------------------------------------------------------------------
| SEARCH USERS
| GET /api/users/search?q=ujjal
|--------------------------------------------------------------------------
*/

router.get(
  "/search",
  authenticate,
  async (req, res) => {
    try {
      const query = String(
        req.query.q || ""
      ).trim();

      /*
      |--------------------------------------------------------------------------
      | Empty search
      |--------------------------------------------------------------------------
      */

      if (!query) {
        return res.json({
          ok: true,
          users: [],
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Search term
      |--------------------------------------------------------------------------
      */

      const searchTerm = `%${query}%`;

      /*
      |--------------------------------------------------------------------------
      | Find users
      |--------------------------------------------------------------------------
      */

      const [rows] =
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

          WHERE id != ?

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
            req.user.id,
            searchTerm,
            searchTerm,
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | Format users
      |--------------------------------------------------------------------------
      */

      const users =
        rows.map(
          formatUser
        );

      return res.json({
        ok: true,
        users,
      });
    } catch (error) {
      console.error(
        "User search error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to search users",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET USERS
| GET /api/users
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  authenticate,
  async (req, res) => {
    try {
      const [rows] =
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

          WHERE id != ?

          ORDER BY
            is_online DESC,
            full_name ASC

          LIMIT 50
          `,
          [
            req.user.id,
          ]
        );

      const users =
        rows.map(
          formatUser
        );

      return res.json({
        ok: true,
        users,
      });
    } catch (error) {
      console.error(
        "Users error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load users",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| UPDATE ONLINE STATUS
| POST /api/users/status
|--------------------------------------------------------------------------
|
| Body:
|
| {
|   "is_online": true
| }
|
*/

router.post(
  "/status",
  authenticate,
  async (req, res) => {
    try {
      const isOnline =
        req.body?.is_online === true ||
        req.body?.is_online === 1 ||
        req.body?.is_online === "1" ||
        req.body?.is_online === "true";

      /*
      |--------------------------------------------------------------------------
      | User is online
      |--------------------------------------------------------------------------
      */

      if (isOnline) {
        await pool.query(
          `
          UPDATE users

          SET
            is_online = 1

          WHERE id = ?
          `,
          [
            req.user.id,
          ]
        );

        return res.json({
          ok: true,
          is_online: true,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | User is offline
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE users

        SET
          is_online = 0,
          last_seen = CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [
          req.user.id,
        ]
      );

      return res.json({
        ok: true,
        is_online: false,
      });
    } catch (error) {
      console.error(
        "Status update error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to update online status",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| HEARTBEAT
| POST /api/users/heartbeat
|--------------------------------------------------------------------------
|
| This endpoint keeps the user online while
| the application is active.
|
*/

router.post(
  "/heartbeat",
  authenticate,
  async (req, res) => {
    try {
      await pool.query(
        `
        UPDATE users

        SET
          is_online = 1

        WHERE id = ?
        `,
        [
          req.user.id,
        ]
      );

      return res.json({
        ok: true,
        is_online: true,
      });
    } catch (error) {
      console.error(
        "Heartbeat error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to update heartbeat",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET USER BY ID
| GET /api/users/:id
|--------------------------------------------------------------------------
*/

router.get(
  "/:id",
  authenticate,
  async (req, res) => {
    try {
      const userId =
        Number(
          req.params.id
        );

      /*
      |--------------------------------------------------------------------------
      | Validate ID
      |--------------------------------------------------------------------------
      */

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid user ID",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Find user
      |--------------------------------------------------------------------------
      */

      const [rows] =
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
          [
            userId,
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | User not found
      |--------------------------------------------------------------------------
      */

      if (rows.length === 0) {
        return res.status(404).json({
          ok: false,
          message:
            "User not found",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Return user
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,
        user:
          formatUser(
            rows[0]
          ),
      });
    } catch (error) {
      console.error(
        "Get user error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load user",
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

export default router;