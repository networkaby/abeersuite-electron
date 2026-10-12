// The browser half of POST /api/hr/attendance/review — one person's day:
// which side pays (auto / manual) and the corrections to the till's figures.
// Shared by the day review and the month view, which both draw the card.

import axios from "axios";
import type { CorrectableField } from "../components/DayActivityCard";

export function saveDaySource(userId: number, date: string, body: {
    useManual?: boolean;
    overrideWorkedMinutes?: number | null;
    overrideLateMinutes?: number | null;
}) {
    return axios.post("/api/hr/attendance/review", { userId, date, ...body });
}

export function saveCorrection(userId: number, date: string, field: CorrectableField, minutes: number | null) {
    return saveDaySource(userId, date, field === "worked" ? { overrideWorkedMinutes: minutes } : { overrideLateMinutes: minutes });
}
