import React from "react";

interface Props {
    message: string;
    icon?: React.ReactNode;
}

export default function CustomerEmptyState({ icon, message }: Props) {
    if (!icon) {
        return (
            <div className="m-auto text-sm text-muted-foreground">{message}</div>
        );
    }
    return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <div className="mb-3">{icon}</div>
            <p className="text-sm">{message}</p>
        </div>
    );
}
