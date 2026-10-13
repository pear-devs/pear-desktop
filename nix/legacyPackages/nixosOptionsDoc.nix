{
  eval,
  nixosOptionsDoc,
}:
nixosOptionsDoc {
  inherit (eval) options;
}
