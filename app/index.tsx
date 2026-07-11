import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { accountsStorage } from "../lib/storage";

export default function Index() {
  const [dest, setDest] = useState<"/(app)/" | "/login" | null>(null);

  useEffect(() => {
    accountsStorage.getActive().then((account) => {
      setDest(account ? "/(app)/" : "/login");
    });
  }, []);

  if (!dest) return null;
  return <Redirect href={dest} />;
}
