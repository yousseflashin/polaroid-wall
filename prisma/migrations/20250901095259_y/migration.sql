/*
  Warnings:

  - You are about to drop the column `limit` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "limit",
ADD COLUMN     "photoCouneter" INTEGER NOT NULL DEFAULT 0;
