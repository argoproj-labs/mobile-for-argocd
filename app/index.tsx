import { Redirect } from "expo-router";
import { useInstanceStore } from "../lib/instanceStore";

export default function Index() {
  const { isLoaded, activeSession } = useInstanceStore();

  if (!isLoaded) return null;
  return <Redirect href={activeSession ? "/(app)/" : "/login"} />;
}
