import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/terminal")({
  beforeLoad: () => {
    throw redirect({ to: "/app/terminal" });
  },
});
