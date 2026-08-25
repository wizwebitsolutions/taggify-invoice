/** Small display-formatting helpers shared across every screen. */

export function money(v: string | number) {
  return `₹${Number(v).toLocaleString("en-IN")}`;
}

export function initialsOf(name?: string | null) {
  if (!name) return "—";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function roleLabel(role?: string) {
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase().replace("_", " ");
}
