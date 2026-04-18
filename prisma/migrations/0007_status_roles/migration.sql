-- Add role and action columns to TicketStatus
ALTER TABLE "TicketStatus"
  ADD COLUMN "allowedRoles" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN "notifyRoles"  TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN "actionLabel"  TEXT;

-- Seed sensible defaults for existing statuses
-- S1 Received: Front Desk creates it → notify Technician to pick up
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R3'],
  "notifyRoles"  = ARRAY['R2'],
  "actionLabel"  = 'New ticket received — assign a technician'
WHERE id = 'S1';

-- S2 Diagnosing: Technician sets it
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2'],
  "notifyRoles"  = '{}'
WHERE id = 'S2';

-- S3 Repairing: Technician sets it
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2'],
  "notifyRoles"  = '{}'
WHERE id = 'S3';

-- S4 Escalated: Technician escalates → notify Despatch to arrange courier
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2'],
  "notifyRoles"  = ARRAY['R4'],
  "actionLabel"  = 'Device escalated — arrange courier to service centre'
WHERE id = 'S4';

-- S5 Received Back: Despatch receives it → notify Technician to continue
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R4'],
  "notifyRoles"  = ARRAY['R2'],
  "actionLabel"  = 'Device received back — continue repair'
WHERE id = 'S5';

-- S6 Ready: Technician/Despatch marks ready → notify Front Desk to call customer
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2','R4'],
  "notifyRoles"  = ARRAY['R3'],
  "actionLabel"  = 'Device ready — contact customer for collection'
WHERE id = 'S6';

-- S7 Returned: Front Desk marks returned
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R3'],
  "notifyRoles"  = '{}'
WHERE id = 'S7';

-- S8 Closed No Fix: Front Desk/Technician closes
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2','R3'],
  "notifyRoles"  = '{}'
WHERE id = 'S8';

-- S9 Cancelled: Any staff can cancel
UPDATE "TicketStatus" SET
  "allowedRoles" = ARRAY['R1','R2','R3','R4'],
  "notifyRoles"  = '{}'
WHERE id = 'S9';
