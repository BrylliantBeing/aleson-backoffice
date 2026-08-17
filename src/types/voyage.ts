import { SeatMap } from "@/utils/seatAssign";

export interface TicketType {
  type: string; // category slug, e.g. "regular"
  price: number;
  currency: string; // "PHP" | "MYR" — international routes price in MYR
}

export interface ClassInfo {
  availability: number;
  ticket_type: TicketType[];
}

export interface Voyage {
  voyage_id: number;
  vessel_name: string;
  class_name: Record<string, ClassInfo>;
  seat_map: SeatMap | null;
  unavailable_seats: string[];
  seat_genders?: Record<string, "Male" | "Female">; // taken cabin/suite berth -> gender
  availablility: Record<string, number>; // misspelled server-side — remaining per class
  departure_time: string | null;
  origin: string;
  destination: string;
}
