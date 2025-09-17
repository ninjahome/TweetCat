using System.Windows.Controls;

namespace TweetCat.App.Win.ViewModels;

public sealed class NavigationItemViewModel : ViewModelBase
{
    private bool _isSelected;

    public NavigationItemViewModel(string title, UserControl content)
    {
        Title = title;
        Content = content;
    }

    public string Title { get; }

    public UserControl Content { get; }

    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}
