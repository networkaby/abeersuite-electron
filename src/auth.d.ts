import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface User {
        id:           string;
        role:         string;
        roles:        string[];
        permissions:  string[];
        rank:         number;
        scope:        string;
        departmentId?: string;
        branchId?:    string;
        title?:       string;
    }

    interface Session {
        user: {
            id:           string;
            role:         string;
            roles:        string[];
            permissions:  string[];
            rank:         number;
            scope:        string;
            departmentId?: string;
            branchId?:    string;
            title?:       string;
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
        departmentId?: string;
        branchId?:     string;
        title?:        string;
    }
}
