import { createContext } from "react";
import type { Machines } from "./machines";

/** Shares saved machine labels with workspace tabs without coupling presentation to the SSH singleton. */
export const MachineContext = createContext<Machines | undefined>(undefined);
