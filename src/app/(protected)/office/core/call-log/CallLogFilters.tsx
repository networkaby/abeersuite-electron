"use client";

import { FormEvent, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type Props = {
    search: string;
    selectedStatus: string;
    selectedDirection: string;
    statusOptions: readonly string[];
    directionOptions: readonly string[];
};

export default function CallLogFilters({
    search,
    selectedStatus,
    selectedDirection,
    statusOptions,
    directionOptions,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const [searchValue, setSearchValue] = useState(search);
    const [status, setStatus] = useState(selectedStatus);
    const [direction, setDirection] = useState(selectedDirection);

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const params = new URLSearchParams();
        if (searchValue.trim()) params.set("search", searchValue.trim());
        if (status) params.set("status", status);
        if (direction) params.set("direction", direction);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
    };

    return (
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 rounded-md border bg-card p-3 md:grid-cols-4">
            <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search customer, phone, or note"
                className="md:col-span-2"
            />
            <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
                <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {statusOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                            {option.charAt(0) + option.slice(1).toLowerCase()}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select value={direction || "all"} onValueChange={(value) => setDirection(value === "all" ? "" : value)}>
                <SelectTrigger>
                    <SelectValue placeholder="All Direction" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Direction</SelectItem>
                    {directionOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                            {option === "INBOUND" ? "Inbound" : "Outbound"}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="flex items-center gap-2 md:col-span-4">
                <Button type="submit">Apply Filters</Button>
                <Button type="button" variant="outline" onClick={() => router.push(pathname)}>
                    Reset
                </Button>
            </div>
        </form>
    );
}
