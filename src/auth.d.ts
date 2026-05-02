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
