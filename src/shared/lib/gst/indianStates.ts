/**
 * Authoritative 2-digit GSTIN state-code → state / UT name map.
 *
 * Used in two places:
 *   • GST tax split logic (compute intra vs inter from sellerState vs buyerState).
 *   • Data-integrity guard (GSTIN first-two-chars must agree with the address
 *     state name on Branch / Organisation / Person / Company).
 *
 * Pure module — no Prisma, no React. Safe to import from anywhere.
 *
 * Reference: official GST State Code list maintained by CBIC. Code "25"
 * (legacy Daman & Diu) is retained for historical rows; new registrations
 * use "26" (merged D&NH and D&D UT).
 */

export type IndianStateEntry = {
    code: string;
    name: string;
    isUT?: boolean;
};

export const INDIAN_STATES: ReadonlyArray<IndianStateEntry> = [
    { code: "01", name: "Jammu and Kashmir",                         isUT: true  },
    { code: "02", name: "Himachal Pradesh"                                        },
    { code: "03", name: "Punjab"                                                  },
    { code: "04", name: "Chandigarh",                                isUT: true  },
    { code: "05", name: "Uttarakhand"                                             },
    { code: "06", name: "Haryana"                                                 },
    { code: "07", name: "Delhi",                                     isUT: true  },
    { code: "08", name: "Rajasthan"                                               },
    { code: "09", name: "Uttar Pradesh"                                           },
    { code: "10", name: "Bihar"                                                   },
    { code: "11", name: "Sikkim"                                                  },
    { code: "12", name: "Arunachal Pradesh"                                       },
    { code: "13", name: "Nagaland"                                                },
    { code: "14", name: "Manipur"                                                 },
    { code: "15", name: "Mizoram"                                                 },
    { code: "16", name: "Tripura"                                                 },
    { code: "17", name: "Meghalaya"                                               },
    { code: "18", name: "Assam"                                                   },
    { code: "19", name: "West Bengal"                                             },
    { code: "20", name: "Jharkhand"                                               },
    { code: "21", name: "Odisha"                                                  },
    { code: "22", name: "Chhattisgarh"                                            },
    { code: "23", name: "Madhya Pradesh"                                          },
    { code: "24", name: "Gujarat"                                                 },
    // Code 25 (Daman and Diu) was retired after merger into UT 26; keep for
    // any legacy invoice data referencing it.
    { code: "25", name: "Daman and Diu",                             isUT: true  },
    { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu",  isUT: true  },
    { code: "27", name: "Maharashtra"                                             },
    { code: "28", name: "Andhra Pradesh (Before Bifurcation)"                     },
    { code: "29", name: "Karnataka"                                               },
    { code: "30", name: "Goa"                                                     },
    { code: "31", name: "Lakshadweep",                               isUT: true  },
    { code: "32", name: "Kerala"                                                  },
    { code: "33", name: "Tamil Nadu"                                              },
    { code: "34", name: "Puducherry",                                isUT: true  },
    { code: "35", name: "Andaman and Nicobar Islands",               isUT: true  },
    { code: "36", name: "Telangana"                                               },
    { code: "37", name: "Andhra Pradesh"                                          },
    { code: "38", name: "Ladakh",                                    isUT: true  },
    { code: "97", name: "Other Territory"                                         },
    { code: "99", name: "Centre Jurisdiction"                                     },
];

const CODE_TO_ENTRY = new Map(INDIAN_STATES.map((s) => [s.code, s]));
const NAME_TO_ENTRY = new Map(INDIAN_STATES.map((s) => [s.name.toLowerCase(), s]));

export function stateNameForCode(code: string | null | undefined): string | null {
    if (!code) return null;
    return CODE_TO_ENTRY.get(code.trim())?.name ?? null;
}

/** Case-insensitive name → code. Strips surrounding whitespace; exact match only. */
export function stateCodeForName(name: string | null | undefined): string | null {
    if (!name) return null;
    return NAME_TO_ENTRY.get(name.trim().toLowerCase())?.code ?? null;
}

export function isUnionTerritory(code: string | null | undefined): boolean {
    if (!code) return false;
    return CODE_TO_ENTRY.get(code.trim())?.isUT === true;
}

export function isValidStateCode(code: string | null | undefined): boolean {
    if (!code) return false;
    return CODE_TO_ENTRY.has(code.trim());
}
