import { Redirect } from "expo-router";
import { useInstanceStore } from "../lib/instanceStore";

export default function Index() {
  const { isLoaded, activeInstance } = useInstanceStore();

  if (!isLoaded) return null;
  return <Redirect href={activeInstance ? "/(app)/" : "/login"} />;
}
