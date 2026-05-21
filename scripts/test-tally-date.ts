import { parseTallyDate, toIsoDate, isoToDisplay } from "../src/shared/hooks/useTallyDate";

const today = new Date(2026, 4, 21); // May 21, 2026 (local)

const cases: [string, string | null][] = [
    ["t",            "21/05/2026"],
    ["to",           "21/05/2026"],
    ["tod",          "21/05/2026"],
    ["toda",         "21/05/2026"],
    ["today",        "21/05/2026"],
    ["T",            "21/05/2026"],
    ["TO",           "21/05/2026"],
    ["Today",        "21/05/2026"],
    ["TODAY",        "21/05/2026"],
    ["+",            "22/05/2026"],
    ["-",            "20/05/2026"],
    ["y",            "20/05/2026"],
    ["ye",           "20/05/2026"],
    ["yes",          "20/05/2026"],
    ["yest",         "20/05/2026"],
    ["yeste",        "20/05/2026"],
    ["yester",       "20/05/2026"],
    ["yesterd",      "20/05/2026"],
    ["yesterda",     "20/05/2026"],
    ["yesterday",    "20/05/2026"],
    ["Y",            "20/05/2026"],
    ["YESTERDAY",    "20/05/2026"],
    ["15",           "15/05/2026"],
    ["23feb",        "23/02/2026"],
    ["23 feb",       "23/02/2026"],
    ["23FEB",        "23/02/2026"],
    ["23mar25",      "23/03/2025"],
    ["15/4",         "15/04/2026"],
    ["15/4/25",      "15/04/2025"],
    ["15-4-25",      "15/04/2025"],
    ["15/04/2025",   "15/04/2025"],
    ["15042025",     "15/04/2025"],
    ["2026-04-15",   "15/04/2026"],
    ["xyz",          null],
    ["",             null],
    ["32",           null],
    ["15/13",        null],
    ["31feb",        null],
];

let pass = 0;
let fail = 0;
for (const [input, expected] of cases) {
    const parsed = parseTallyDate(input, today);
    const got = parsed ? isoToDisplay(toIsoDate(parsed)) : null;
    const ok = got === expected;
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  "${input}" -> ${got}  (expected ${expected})`);
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
