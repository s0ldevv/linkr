import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/launches")({
  beforeLoad: () => {
    throw redirect({ to: "/explore" });
  },
});
