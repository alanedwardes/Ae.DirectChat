using ReactiveUI;
using System;
using System.Windows.Input;

namespace Ae.Chat.Interface.ViewModels
{
    public class MainWindowViewModel : ViewModelBase
    {
        public string Server { get; set; }

        public ICommand ConnectCommand { get; set; }

        public MainWindowViewModel()
        {
            ConnectCommand = ReactiveCommand.Create(() => Console.WriteLine(""));
        }
    }
}
