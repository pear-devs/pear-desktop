# Nix

## Home Manager

Add this repository as a flake input.

```nix
{
  inputs = {
    pear-desktop = {
      url = "github:pear-devs/pear-desktop";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
```

Then import `homeManagerModules.default` and configure it in your home module:

```nix
{ inputs, ... }:
{
  imports = [
    inputs.pear-desktop.homeManagerModules.default
  ];

  programs.pear-desktop = {
    # This adds the package to your PATH
    enable = true;

    options = {
      themes = [
        # Custom CSS style stored in the nix store
        ./style.css
      ];
      tray = true;
      trayClickPlayPause = false;
    };

    plugins = {
      do-not-track.enable = true;
      exponential-volume.enable = true;
    };
  };
}
```

> [!NOTE]
> You need to use
> [`extraSpecialArgs`](https://nix-community.github.io/home-manager/nix-flakes/standalone.html?highlight=extraspecialargs#standalone-setup)
> to access your flake inputs inside the home module.
