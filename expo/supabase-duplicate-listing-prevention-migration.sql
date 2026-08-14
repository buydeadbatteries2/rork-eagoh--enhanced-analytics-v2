-- ─────────────────────────────────────────────────────────────────────────
-- Duplicate Exchange Listing Prevention Migration
--
-- Problem: When a vendor creates an Exchange listing, a double-tap or retry
-- can create two identical rows in marketplace_listings for the same
-- vendor_id + eagoh_id combination.
--
-- Solution: Add a partial unique index that prevents more than one ACTIVE
-- listing per (vendor_id, eagoh_id) pair. This is the database-level
-- last line of defense behind the client re-entry guard and the service-
-- layer dedup query.
--
-- Inactive listings are excluded from the constraint — a vendor can
-- deactivate a listing and create a new one for the same EAGOH later.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Clean up existing duplicates BEFORE creating the unique index.
--    Keeps the most recently created active listing per (vendor_id, eagoh_id)
--    and deactivates the older duplicates. Does NOT delete any rows — only
--    sets active = false on the superseded duplicates.
--    This preserves data integrity and avoids losing legitimate listings.

UPDATE marketplace_listings ml
SET active = false,
    updated_at = now()
WHERE active = true
  AND id NOT IN (
    SELECT DISTINCT ON (vendor_id, eagoh_id)
           id
    FROM   marketplace_listings
    WHERE  active = true
    ORDER  BY vendor_id, eagoh_id, created_at DESC
  );

-- 2. Create the partial unique index.
--    Only one ACTIVE listing per (vendor_id, eagoh_id) at any time.
--    Inactive listings are unconstrained so vendors can deactivate and
--    re-list the same EAGOH.

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_listings_active_vendor_eagoh
    ON marketplace_listings (vendor_id, eagoh_id)
    WHERE active = true;
