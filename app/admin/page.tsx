import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/AdminApp";

export const metadata: Metadata = { title: "Администрация - Дистриктна Интеракт Асамблея - „Игра“", robots: { index: false } };

export default function Page() {
  return <AdminApp />;
}
