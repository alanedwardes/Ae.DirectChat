FROM mcr.microsoft.com/dotnet/core/sdk:3.1

RUN mkdir /opt/aechat

ADD . /opt/aechat

EXPOSE 8100/udp

ENTRYPOINT ["dotnet", "run", "--project", "/opt/aechat/src/Ae.Chat.Server/Ae.Chat.Server.csproj"]