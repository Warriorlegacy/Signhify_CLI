{
  description = "Signhify — AI engineering partner in the terminal and IDE";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f system);
  in {
    devShells = forAllSystems (system: let
      pkgs = import nixpkgs { inherit system; };
    in {
      default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodejs_20
          nodePackages.npm
          openssl
          git
          pkg-config
        ];

        shellHook = ''
          echo "┌─────────────────────────────────────────────┐"
          echo "│        Signhify Development Shell            │"
          echo "│  Node.js $(node --version)                     │"
          echo "│  npm $(npm --version)                          │"
          echo "└─────────────────────────────────────────────┘"
          echo ""
          echo "Quick start:"
          echo "  npm install && npm run build"
          echo "  npm test"
        '';
      };
    });

    packages = forAllSystems (system: let
      pkgs = import nixpkgs { inherit system; };
    in {
      default = pkgs.buildNpmPackage {
        name = "signhify";
        src = ./.;
        npmDepsHash = "sha256-0000000000000000000000000000000000000000000=";
      };
    });
  };
}
