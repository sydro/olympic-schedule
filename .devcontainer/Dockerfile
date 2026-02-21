ARG FEDORA_VERSION=39
FROM fedora:${FEDORA_VERSION}

# Installa GNOME e strumenti essenziali per estensioni
RUN dnf install -y \
    gnome-shell gnome-extensions-app gnome-tweaks gnome-terminal \
    gnome-control-center gjs gettext make git \
    dbus-x11 glib2-devel \
    xorg-x11-xauth at-spi2-core && \
    dnf clean all