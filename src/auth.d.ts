import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface User {
        id:            string;
        role:          string;
        roles:         string[];
        permissions:   string[];
        rank:          number;
        scope:         string;
        roleLabel?:    string;
        roleColor?:    string;
        departmentIds?: string[];
        branchIds?:    string[];
        title?:        string;
        avatarUrl?:    string;
        kind?:         "staff" | "customer";
        customerId?: string;
        activeAccountId?: string;
        activeAccountType?: "personal" | "company";
    }

    interface Session {
        user: {
            id:             string;
            role:           string;
            roles:          string[];
            permissions:    string[];
            rank:           number;
            scope:          string;
            roleLabel?:     string;
            roleColor?:     string;
            departmentIds?: string[];
            branchIds?:     string[];
            title?:         string;
            avatarUrl?:     string;
            kind?:          "staff" | "customer";
            customerId?:  string;
            activeAccountId?: string;
            activeAccountType?: "personal" | "company";
        } & DefaultSession["user"];
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        /// Epoch ms when this token was issued at login — compared against the
        /// user's `tokensValidFrom` to enforce server-side revocation.
        loginAt?:      number;
        /// Set by the jwt callback when the token has been revoked server-side
        /// (login predates the user's `tokensValidFrom`); the session callback
        /// then blanks the user so guards reject it.
        revoked?:      boolean;
        id?:           string;
        role?:         string;
        roles?:        string[];
        permissions?:  string[];
        rank?:         number;
        scope?:        string;
        roleLabel?:     string;
        roleColor?:     string;
        departmentIds?: string[];
        branchIds?:     string[];
        title?:         string;
        avatarUrl?:     string;
        kind?:          "staff" | "customer";
        customerId?:   string;
        activeAccountId?: string;
        activeAccountType?: "personal" | "company";
    }
}
