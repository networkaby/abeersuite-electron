/** Inline validation line under a form control. Renders nothing when there is no message. */
export function FieldError({ message }: { message?: string | null }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}
