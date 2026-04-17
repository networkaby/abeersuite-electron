-- Create Priority lookup table
CREATE TABLE "Priority" (
    "id"    TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Priority_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Priority" ("id", "label", "color", "order") VALUES
    ('P1', 'Low',    'bg-gray-100 text-gray-500',     1),
    ('P2', 'Normal', 'bg-blue-50 text-blue-500',      2),
    ('P3', 'High',   'bg-orange-100 text-orange-500', 3),
    ('P4', 'Urgent', 'bg-red-100 text-red-600',       4);

-- Create Role lookup table
CREATE TABLE "Role" (
    "id"    TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Role" ("id", "label", "color") VALUES
    ('R1', 'Admin',      'bg-red-100 text-red-600'),
    ('R2', 'Technician', 'bg-blue-100 text-blue-600'),
    ('R3', 'Front Desk', 'bg-green-100 text-green-600');

-- Add FK: Ticket.priority → Priority
ALTER TABLE "Ticket"
    ADD CONSTRAINT "Ticket_priority_fkey"
    FOREIGN KEY ("priority") REFERENCES "Priority"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add FK: User.role → Role
ALTER TABLE "User"
    ADD CONSTRAINT "User_role_fkey"
    FOREIGN KEY ("role") REFERENCES "Role"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
