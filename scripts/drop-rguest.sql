UPDATE "User" SET "role" = NULL WHERE "role" = 'R-GUEST';
DELETE FROM "RolePermission" WHERE "roleId" = 'R-GUEST';
DELETE FROM "Role" WHERE "id" = 'R-GUEST';
