-- Seasonal office hours: the shop's own opening/closing move out of code and
-- into the singleton, with one opening per solstice.
--
-- Behaviour-neutral on the way in: both anchors default to the 10:30 the code
-- already used, which flattens the curve to the old fixed time. Nothing changes
-- until an admin sets a winter opening that differs from the summer one.
ALTER TABLE "OrgDefaults" ADD COLUMN     "dutyEnd" VARCHAR(5) NOT NULL DEFAULT '20:30',
ADD COLUMN     "dutySummerStart" VARCHAR(5) NOT NULL DEFAULT '10:30',
ADD COLUMN     "dutyWinterStart" VARCHAR(5) NOT NULL DEFAULT '10:30',
ADD COLUMN     "weeklyOff" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
