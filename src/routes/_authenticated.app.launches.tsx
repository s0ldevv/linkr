import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/launches")({
  beforeLoad: () => {
    throw redirect({ to: "/app/explore" });
  },
});
