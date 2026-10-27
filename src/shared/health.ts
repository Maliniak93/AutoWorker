export interface ToolStatus {
  status: "ok" | "missing";
  version?: string;
}

export interface GhStatus extends ToolStatus {
  loggedIn: boolean;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  tools: {
    claude: ToolStatus;
    git: ToolStatus;
    gh: GhStatus;
  };
}
