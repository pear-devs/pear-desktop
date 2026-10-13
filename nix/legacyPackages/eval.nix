{
  lib,
  pkgs,
  module,
}:
lib.evalModules {
  modules = [
    {
      config = {
        _module.check = false;
      };
    }
    module
  ];

  specialArgs = {
    inherit pkgs;
  };
}
