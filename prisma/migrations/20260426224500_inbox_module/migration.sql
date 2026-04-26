-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('SYSTEM_INBOX', 'PERSONAL_INBOX', 'ROLE_GROUP', 'ORG_GROUP');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('SYSTEM', 'USER');

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ChatRoomType" NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" INTEGER,
    "roleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoomMember" (
    "id" SERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderUserId" INTEGER,
    "messageType" "ChatMessageType" NOT NULL DEFAULT 'USER',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_key_key" ON "ChatRoom"("key");

-- CreateIndex
CREATE INDEX "ChatRoom_type_idx" ON "ChatRoom"("type");

-- CreateIndex
CREATE INDEX "ChatRoom_ownerUserId_idx" ON "ChatRoom"("ownerUserId");

-- CreateIndex
CREATE INDEX "ChatRoom_roleId_idx" ON "ChatRoom"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomMember_roomId_userId_key" ON "ChatRoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_createdAt_idx" ON "ChatMessage"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderUserId_idx" ON "ChatMessage"("senderUserId");

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
